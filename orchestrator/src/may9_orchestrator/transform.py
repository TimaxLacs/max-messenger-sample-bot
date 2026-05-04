from __future__ import annotations

import asyncio
import io
import logging

import httpx
from PIL import Image, ImageDraw, ImageFont

from may9_orchestrator.config import Settings

logger = logging.getLogger(__name__)

MAX_DIMENSION = 1280


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

    url = settings.ai_transform_url
    if url:
        try:
            return await _external_ai(url, image_bytes, settings.ai_transform_timeout_seconds)
        except (httpx.HTTPError, OSError, ValueError) as err:
            logger.warning("external AI failed, falling back to local overlay: %s", err)
    return await asyncio.to_thread(apply_may9_overlay, image_bytes)
