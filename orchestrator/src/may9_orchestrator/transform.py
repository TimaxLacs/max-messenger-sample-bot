from __future__ import annotations

import asyncio
import base64
import io
import logging

import httpx
from PIL import Image, ImageDraw, ImageFont

from may9_orchestrator.config import Settings

logger = logging.getLogger(__name__)

MAX_DIMENSION = 1280
_LUKOSHKO_POLL_INTERVAL = 2.0
_LUKOSHKO_MAX_POLLS = 90  # 3 minutes max


def _load_font(size: int) -> ImageFont.ImageFont:
    candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def apply_may9_overlay(image_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(image_bytes))
    img = img.convert("RGB")

    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)

    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    w, h = img.size
    stripe_h = max(72, min(140, int(h * 0.14)))
    y0 = h - stripe_h
    draw.rectangle((0, y0, w, h), fill=(139, 0, 0, 210))

    font_lg = _load_font(max(26, stripe_h // 4))
    font_sm = _load_font(max(18, stripe_h // 6))

    main = "9 мая • С Днём Победы!"
    small = "Память о подвиге живёт"

    bw, bh = draw.textbbox((0, 0), main, font=font_lg)[2:]
    sw, sh = draw.textbbox((0, 0), small, font=font_sm)[2:]

    draw.text(((w - bw) / 2, y0 + stripe_h // 6), main, font=font_lg, fill=(255, 246, 200, 255))
    draw.text(((w - sw) / 2, y0 + stripe_h // 2 + bh // 10), small, font=font_sm, fill=(255, 255, 255, 235))

    img_rgba = img.convert("RGBA")
    blended = Image.alpha_composite(img_rgba, overlay).convert("RGB")

    out = io.BytesIO()
    blended.save(out, format="JPEG", quality=90, optimize=True)
    return out.getvalue()


def _find_result_url(data: dict, base_url: str) -> str | None:
    """
    Extract result_url from job status response and make it absolute.
    state_history can be a dict {"result_url": "..."} or a list of dicts.
    """
    raw: str | None = None

    state_history = data.get("state_history")
    if isinstance(state_history, dict):
        raw = state_history.get("result_url")
    elif isinstance(state_history, list):
        for entry in state_history:
            if isinstance(entry, dict) and "result_url" in entry:
                raw = entry["result_url"]
                break

    if raw is None:
        raw = data.get("result_url")

    if not raw:
        return None

    return f"{base_url}{raw}" if raw.startswith("/") else raw


async def _lukoshko_ai(
    base_url: str,
    token: str,
    image_bytes: bytes,
    preset: str | None = None,
) -> bytes:
    """
    Calls the Lukoshko async image processing API.
    1. POST /api/v1/image_flip  → get job_id
    2. Poll GET /api/v1/jobs/{id} until status == "finished"
    3. Download from result_url (public, no auth needed)
    """
    b64 = base64.b64encode(image_bytes).decode("ascii")
    auth_headers = {"X-Client-Token": token}
    payload: dict = {"initial_data": {"image_base64": b64}}
    if preset:
        payload["initial_data"]["preset"] = preset

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        # Step 1: start job
        resp = await client.post(
            f"{base_url}/api/v1/image_flip",
            headers={**auth_headers, "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        start_data = resp.json()
        job_id = start_data.get("job_id")
        if not job_id:
            raise ValueError(f"Lukoshko: no job_id in response: {start_data}")
        logger.info("Lukoshko job started: %s", job_id)

        # Step 2: poll for completion
        for attempt in range(_LUKOSHKO_MAX_POLLS):
            await asyncio.sleep(_LUKOSHKO_POLL_INTERVAL)
            poll = await client.get(
                f"{base_url}/api/v1/jobs/{job_id}",
                headers=auth_headers,
            )
            poll.raise_for_status()
            status_data = poll.json()
            current_status = status_data.get("status") or status_data.get("current_state", "")

            if current_status == "finished":
                result_url = _find_result_url(status_data, base_url)
                if not result_url:
                    raise ValueError(f"Lukoshko: finished but no result_url: {status_data}")
                logger.info("Lukoshko job %s finished → %s", job_id, result_url)

                # Step 3: download (no auth required for download URLs)
                dl = await client.get(result_url)
                dl.raise_for_status()
                return dl.content

            if current_status in ("failed", "error", "cancelled"):
                raise RuntimeError(f"Lukoshko job {job_id} status={current_status}")

            if attempt % 5 == 0:
                logger.debug("Lukoshko job %s: %s (poll %d/%d)", job_id, current_status, attempt, _LUKOSHKO_MAX_POLLS)

        raise TimeoutError(f"Lukoshko job {job_id} timed out after {_LUKOSHKO_MAX_POLLS * _LUKOSHKO_POLL_INTERVAL:.0f}s")


async def _external_ai(url: str, image_bytes: bytes, timeout_seconds: float) -> bytes:
    async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True) as client:
        resp = await client.post(
            url,
            files={"file": ("photo.jpg", image_bytes, "image/jpeg")},
            data={"preset": "may9"},
        )
    resp.raise_for_status()
    return resp.content


async def transform_image(image_bytes: bytes, settings: Settings) -> bytes:
    if settings.stub_delay_seconds > 0:
        await asyncio.sleep(settings.stub_delay_seconds)

    # Priority 1: Lukoshko API (new async worker)
    if settings.lukoshko_token:
        try:
            return await _lukoshko_ai(settings.lukoshko_base_url, settings.lukoshko_token, image_bytes)
        except Exception as err:
            logger.warning("Lukoshko AI failed, falling back: %s", err)

    # Priority 2: custom AI_TRANSFORM_URL (legacy multipart endpoint)
    if settings.ai_transform_url:
        try:
            return await _external_ai(settings.ai_transform_url, image_bytes, settings.ai_transform_timeout_seconds)
        except (httpx.HTTPError, OSError, ValueError) as err:
            logger.warning("external AI failed, falling back to local overlay: %s", err)

    # Fallback: local May 9 overlay
    return await asyncio.to_thread(apply_may9_overlay, image_bytes)
