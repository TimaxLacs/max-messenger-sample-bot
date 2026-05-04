from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    host: str = "0.0.0.0"
    port: int = 8000
    internal_token: str = ""
    data_dir: str = "./data"
    max_per_user_per_day: int = 1
    timezone: str = "Europe/Moscow"
    ai_transform_url: str | None = None
    ai_transform_timeout_seconds: float = 120.0
    stub_delay_seconds: float = 0.0

    @staticmethod
    def from_env() -> Settings:
        return Settings(
            host=os.getenv("HOST", "0.0.0.0"),
            port=int(os.getenv("PORT", "8000")),
            internal_token=os.getenv("INTERNAL_TOKEN", "").strip(),
            data_dir=os.getenv("DATA_DIR", "./data").strip(),
            max_per_user_per_day=int(os.getenv("MAX_PER_USER_PER_DAY", "1")),
            timezone=os.getenv("QUOTA_TIMEZONE", "Europe/Moscow").strip(),
            ai_transform_url=(u.strip() if (u := os.getenv("AI_TRANSFORM_URL")) else None),
            ai_transform_timeout_seconds=float(os.getenv("AI_TRANSFORM_TIMEOUT_SECONDS", "120")),
            stub_delay_seconds=float(os.getenv("STUB_DELAY_SECONDS", "0")),
        )
