"""
Hexa vision sidecar — FastAPI surface.

OPTIONAL SERVICE. Hexa renders without it; `@hexa/vision` degrades to pure-TS
heuristics when nothing answers on the endpoint. What this sidecar adds is the
part that cannot be faked in TypeScript: real face detection, real ArcFace
embeddings and therefore real identity verification of the finished render.

Contract notes
--------------
* Every response body is JSON. Images go in as `image_base64` (raw or data URI)
  or `image_path` (absolute) and come out as base64 PNG.
* Every failure — validation, missing model, unknown route, unexpected crash —
  is answered as {"error": {"code", "message", "hint"?}} with a real HTTP
  status. A traceback never reaches the client; it goes to the server log.
* Models load lazily on first use, so GET /health answers in microseconds even
  on a cold process.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

import pipeline
from pipeline import VisionError

logger = logging.getLogger("hexa.vision")
logging.basicConfig(
    level=os.environ.get("HEXA_VISION_LOG", "INFO").upper(),
    format="%(asctime)s %(levelname)-5s %(name)s %(message)s",
)

app = FastAPI(
    title="Hexa Vision Sidecar",
    version=pipeline.__version__,
    description="Face detection, ArcFace embeddings, alpha-matted segmentation and image metrics for Hexa.",
)


# ---------------------------------------------------------------------------
# Structured errors
# ---------------------------------------------------------------------------


def error_body(code: str, message: str, hint: Optional[str] = None) -> Dict[str, Any]:
    err: Dict[str, Any] = {"code": code, "message": message}
    if hint:
        err["hint"] = hint
    return {"error": err}


@app.exception_handler(VisionError)
async def _handle_vision_error(_: Request, exc: VisionError) -> JSONResponse:
    logger.warning("%s: %s", exc.code, exc.message)
    return JSONResponse(status_code=exc.status, content=error_body(exc.code, exc.message, exc.hint))


@app.exception_handler(RequestValidationError)
async def _handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    try:
        first = exc.errors()[0]
        loc = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        detail = f"{loc}: {first.get('msg')}" if loc else str(first.get("msg"))
    except Exception:  # pragma: no cover - defensive
        detail = "request body failed validation"
    return JSONResponse(status_code=422, content=error_body("INVALID_REQUEST", detail))


@app.exception_handler(StarletteHTTPException)
async def _handle_http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 413: "IMAGE_TOO_LARGE"}.get(exc.status_code, "HTTP_ERROR")
    return JSONResponse(status_code=exc.status_code, content=error_body(code, str(exc.detail)))


@app.exception_handler(Exception)
async def _handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
    # Log the traceback here; return a clean body to the caller.
    logger.exception("unhandled error: %s", exc)
    return JSONResponse(
        status_code=500,
        content=error_body("INTERNAL_ERROR", f"{type(exc).__name__}: {exc}"),
    )


@app.middleware("http")
async def _timing(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - started) * 1000.0
    response.headers["X-Hexa-Vision-Version"] = pipeline.__version__
    response.headers["X-Hexa-Vision-Ms"] = f"{ms:.1f}"
    if request.url.path != "/health":
        logger.info("%s %s -> %s in %.0fms", request.method, request.url.path, response.status_code, ms)
    return response


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ImageRef(BaseModel):
    image_base64: Optional[str] = Field(default=None, description="Raw base64 or a data: URI")
    image_path: Optional[str] = Field(default=None, description="Absolute path readable by the sidecar")
    image: Optional[str] = Field(default=None, description="Either of the above; absolute paths are auto-detected")

    def load(self):
        return pipeline.load_image(self.image_base64, self.image_path, self.image)


class DetectRequest(ImageRef):
    max_faces: Optional[int] = Field(default=None, ge=1, le=64)
    min_confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class EmbedRequest(ImageRef):
    pass


class EmbedBatchRequest(BaseModel):
    images: List[ImageRef] = Field(default_factory=list, max_length=256)
    fail_fast: bool = Field(
        default=False,
        description="If false (default) a bad image yields a null entry with an error instead of failing the batch.",
    )


class SimilarityRequest(BaseModel):
    a: ImageRef
    b: ImageRef


class SegmentRequest(ImageRef):
    bust: bool = Field(default=False, description="Frame head-and-shoulders from landmarks instead of the full frame")
    feather: float = Field(default=0.0, ge=0.0, le=32.0, description="Gaussian sigma applied to alpha after refinement")
    alpha_matting: bool = Field(default=True)
    fg_threshold: int = Field(default=240, ge=0, le=255, description="rembg alpha_matting_foreground_threshold")
    bg_threshold: int = Field(default=12, ge=0, le=255, description="rembg alpha_matting_background_threshold")
    erode: int = Field(default=8, ge=0, le=64, description="rembg alpha_matting_erode_size (trimap unknown band)")
    model: Optional[str] = Field(default=None, description="rembg model, e.g. isnet-general-use or u2net")
    edge_refine: bool = Field(default=True, description="Guided/bilateral snap of the matte onto real image edges")
    decontaminate: bool = Field(default=True, description="Remove background colour bleed from soft pixels")
    shoulder_ratio: float = Field(default=1.9, ge=1.2, le=3.5, description="Shoulder line, in head-heights below crown")


class MetricsRequest(ImageRef):
    palette_size: int = Field(default=5, ge=1, le=8)
    with_face: bool = Field(default=True)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> Dict[str, Any]:
    """Instant liveness probe. Never triggers a model load — the TypeScript
    client calls this with a ~1.5s budget before every render batch."""
    return {
        "status": "ok",
        "models": pipeline.model_status(),
        "version": pipeline.__version__,
    }


@app.post("/warmup")
def warmup() -> Dict[str, Any]:
    """Optional: pay the cold-start cost up front instead of on the first job."""
    started = time.perf_counter()
    result = pipeline.warm_up()
    return {"models": result, "ms": round((time.perf_counter() - started) * 1000.0, 1)}


@app.post("/detect")
def detect(req: DetectRequest) -> Dict[str, Any]:
    img = req.load()
    faces = pipeline.detect_faces(img, max_faces=req.max_faces, min_confidence=req.min_confidence)
    return {
        "faces": faces,
        "width": int(img.shape[1]),
        "height": int(img.shape[0]),
        "model": pipeline.EMBED_MODEL_NAME,
    }


@app.post("/embed")
def embed(req: EmbedRequest) -> Dict[str, Any]:
    img = req.load()
    return pipeline.embed_primary(img)


@app.post("/embed_batch")
def embed_batch(req: EmbedBatchRequest) -> Dict[str, Any]:
    if not req.images:
        return {"embeddings": [], "model": pipeline.EMBED_MODEL_NAME}
    # Touch the model once so a missing install fails the whole batch cleanly
    # rather than N times over.
    pipeline.get_face_app()
    out: List[Optional[Dict[str, Any]]] = []
    errors: List[Optional[Dict[str, str]]] = []
    for idx, ref in enumerate(req.images):
        try:
            out.append(pipeline.embed_primary(ref.load()))
            errors.append(None)
        except VisionError as err:
            if req.fail_fast:
                raise
            logger.info("embed_batch[%d] %s: %s", idx, err.code, err.message)
            out.append(None)
            errors.append({"code": err.code, "message": err.message})
    return {"embeddings": out, "errors": errors, "model": pipeline.EMBED_MODEL_NAME}


@app.post("/similarity")
def similarity(req: SimilarityRequest) -> Dict[str, Any]:
    return pipeline.similarity(req.a.load(), req.b.load())


@app.post("/segment")
def segment(req: SegmentRequest) -> Dict[str, Any]:
    img = req.load()
    result = pipeline.segment(
        img,
        bust=req.bust,
        feather=req.feather,
        alpha_matting=req.alpha_matting,
        fg_threshold=req.fg_threshold,
        bg_threshold=req.bg_threshold,
        erode=req.erode,
        model=req.model,
        edge_refine=req.edge_refine,
        decontaminate=req.decontaminate,
        shoulder_ratio=req.shoulder_ratio,
    )
    png = result.pop("png")
    result["png_base64"] = pipeline.to_base64(png)
    result["bytes"] = len(png)
    return result


@app.post("/metrics")
def metrics(req: MetricsRequest) -> Dict[str, Any]:
    img = req.load()
    return pipeline.compute_metrics(img, palette_size=req.palette_size, with_face=req.with_face)


def main() -> None:  # pragma: no cover - process entrypoint
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.environ.get("HEXA_VISION_HOST", "127.0.0.1"),
        port=int(os.environ.get("HEXA_VISION_PORT", "8765")),
        log_level=os.environ.get("HEXA_VISION_LOG", "info").lower(),
    )


if __name__ == "__main__":  # pragma: no cover
    main()
