from __future__ import annotations

import asyncio
import base64
import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse

from may9_orchestrator.config import Settings
from may9_orchestrator.db import (
    QuotaExceededError,
    blocking,
    connection,
    get_day_for_quota,
    get_job,
    init_db,
    refund_quota,
    reserve_quota_and_insert_job,
    update_job_done,
    update_job_failed,
    update_job_processing,
    register_user,
    get_referral_bonus,
)
from pydantic import BaseModel
from may9_orchestrator.transform import transform_image

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

settings = Settings.from_env()


def verify_internal_token(x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None) -> None:
    if not settings.internal_token:
        return
    tok = x_internal_token or ""
    if tok != settings.internal_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not settings.internal_token:
        logger.warning(
            "INTERNAL_TOKEN пустой: /internal/* без проверки заголовка (только для разработки; в проде задайте токен).",
        )
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    db_path = Path(settings.data_dir) / "orchestrator.db"
    init_db(db_path)
    yield


app = FastAPI(title="may9-orchestrator", version="0.1.0", lifespan=lifespan)

MAX_UPLOAD_BYTES = 15 * 1024 * 1024


class UserRegisterReq(BaseModel):
    user_id: str
    invited_by: str | None = None

@app.post("/internal/v1/users", dependencies=[Depends(verify_internal_token)])
async def create_user(req: UserRegisterReq) -> JSONResponse:
    db_path = Path(settings.data_dir) / "orchestrator.db"
    def _inner() -> bool:
        with connection(db_path) as conn:
            return register_user(conn, user_id=req.user_id, invited_by=req.invited_by)
    new_user = await blocking(_inner)
    return JSONResponse(status_code=200, content={"new_user": new_user})

@app.get("/internal/v1/users/{user_id}/bonus", dependencies=[Depends(verify_internal_token)])
async def get_bonus(user_id: str) -> JSONResponse:
    db_path = Path(settings.data_dir) / "orchestrator.db"
    def _inner() -> int:
        with connection(db_path) as conn:
            return get_referral_bonus(conn, user_id=user_id)
    bonus = await blocking(_inner)
    return JSONResponse(status_code=200, content={"bonus": bonus})

@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


async def run_pipeline(job_id: str, user_id: str, day: str, blob: bytes) -> None:
    db_path = Path(settings.data_dir) / "orchestrator.db"

    async def step_processing() -> None:
        def _inner() -> None:
            with connection(db_path) as conn:
                update_job_processing(conn, job_id=job_id)

        await blocking(_inner)

    async def step_done(result: bytes) -> None:
        def _inner() -> None:
            with connection(db_path) as conn:
                update_job_done(conn, job_id=job_id, result=result)

        await blocking(_inner)

    async def step_fail(exc: BaseException) -> None:
        msg = str(exc)[:900]

        def _inner() -> None:
            with connection(db_path) as conn:
                update_job_failed(conn, job_id=job_id, error=msg)
                refund_quota(conn, user_id=user_id, day=day)

        await blocking(_inner)

    try:
        await step_processing()
        out = await transform_image(blob, settings)
        await step_done(out)
    except Exception as err:
        logger.exception("job %s failed", job_id)
        await step_fail(err)


@app.post("/internal/v1/jobs", dependencies=[Depends(verify_internal_token)])
async def create_job(
    user_id: Annotated[str, Form()],
    photo: Annotated[UploadFile, File(description="JPEG/PNG пользователя")],
) -> JSONResponse:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=400, detail="user_id required")

    blob = await photo.read()
    if not blob:
        raise HTTPException(status_code=400, detail="empty file")
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="file too large")

    job_id = str(uuid.uuid4())
    db_path = Path(settings.data_dir) / "orchestrator.db"
    day = get_day_for_quota(settings.timezone)

    def reserve() -> None:
        with connection(db_path) as conn:
            reserve_quota_and_insert_job(
                conn,
                job_id=job_id,
                user_id=uid,
                day=day,
                base_limit=settings.max_per_user_per_day,
            )

    try:
        await blocking(reserve)
    except QuotaExceededError as err:
        return JSONResponse(
            status_code=429,
            content={
                "error": "quota_exceeded",
                "message": f"Сегодня лимит исчерпан — доступно {err.limit} откр. в сутки. Приглашайте друзей по ссылке, чтобы увеличить лимит!",
                "limit": err.limit,
            },
        )

    async def guarded() -> None:
        try:
            await run_pipeline(job_id, uid, day, blob)
        except Exception:
            logger.exception("unexpected pipeline crash job=%s", job_id)

    asyncio.create_task(guarded())

    return JSONResponse(status_code=202, content={"job_id": job_id, "status": "queued"})


@app.get("/internal/v1/jobs/{job_id}", dependencies=[Depends(verify_internal_token)])
async def read_job(job_id: str, user_id: Annotated[str, Header(alias="X-User-Id")]) -> dict:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=400, detail="X-User-Id required")

    db_path = Path(settings.data_dir) / "orchestrator.db"

    def fetch() -> dict | None:
        with connection(db_path) as conn:
            return get_job(conn, job_id=job_id, user_id=uid)

    row = await blocking(fetch)
    if row is None:
        raise HTTPException(status_code=404, detail="not found")

    if row["status"] == "done" and row["result_blob"]:
        b64 = base64.b64encode(row["result_blob"]).decode("ascii")
        return {"job_id": job_id, "status": "done", "image_base64": b64}

    body: dict = {"job_id": job_id, "status": row["status"], "error": row["error"]}
    return body
