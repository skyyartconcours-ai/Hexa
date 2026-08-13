"""
Hexa vision sidecar — model wrappers and image operations.

This module is deliberately framework-free: `app.py` owns HTTP concerns and this
file owns pixels and models. Everything here raises `VisionError` (never a bare
exception) so the HTTP layer can always answer with a structured body.

MODEL LOADING POLICY
--------------------
Nothing heavy is imported at module import time. `insightface`, `onnxruntime`
and `rembg` each cost seconds to import and tens of seconds to warm on first
use; importing them here would make `GET /health` slow and would make the whole
sidecar look "down" to the TypeScript client during startup. Instead every model
is created on first use inside a double-checked lock and cached in a module
global. `numpy`, `cv2` and `PIL` *are* imported eagerly — they are cheap and are
needed by pure-CV endpoints that must work even when no ML model is available.
"""

from __future__ import annotations

import base64
import binascii
import math
import os
import threading
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image

__version__ = "0.1.0"

# ---------------------------------------------------------------------------
# Configuration (all overridable by environment so run.sh / Dockerfile can tune)
# ---------------------------------------------------------------------------

EMBED_MODEL_NAME = os.environ.get("HEXA_VISION_FACE_MODEL", "buffalo_l")
DEFAULT_SEG_MODEL = os.environ.get("HEXA_VISION_SEG_MODEL", "isnet-general-use")
DET_SIZE = int(os.environ.get("HEXA_VISION_DET_SIZE", "640"))
DEVICE = os.environ.get("HEXA_VISION_DEVICE", "cpu").lower()

# Guard against decompression bombs / accidental 20000px source scans.
MAX_PIXELS = int(os.environ.get("HEXA_VISION_MAX_PIXELS", str(64 * 1024 * 1024)))
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

# Sharpness is variance-of-Laplacian, which scales with resolution. Everything
# is measured on a long-edge-normalised copy so the "<40 is soft" rule in
# @hexa/core's AssetMetrics doc comment means the same thing for a 900px press
# crop and a 6000px raw frame.
SHARPNESS_LONG_EDGE = 1024

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class VisionError(Exception):
    """Structured failure. `code` is stable and machine-readable; `status` is the
    HTTP status the API layer should answer with."""

    def __init__(self, code: str, message: str, status: int = 400, hint: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.hint = hint


# ---------------------------------------------------------------------------
# Lazy model registry
# ---------------------------------------------------------------------------

_model_lock = threading.Lock()
_face_app: Any = None
_face_app_error: Optional[str] = None
_seg_sessions: Dict[str, Any] = {}

# insightface/onnxruntime sessions are not safe to call concurrently from
# several threads. FastAPI runs `def` endpoints in a threadpool, so inference is
# serialised here. The sidecar is a single-user local helper; throughput is not
# the design goal, correctness is.
_infer_lock = threading.RLock()


def _providers() -> List[str]:
    if DEVICE in ("cuda", "gpu"):
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def _ctx_id() -> int:
    return 0 if DEVICE in ("cuda", "gpu") else -1


def get_face_app() -> Any:
    """Load (once) the insightface FaceAnalysis bundle used for detection,
    5-point landmarks, 3D-landmark head pose and 512-d ArcFace embeddings."""
    global _face_app, _face_app_error
    if _face_app is not None:
        return _face_app
    with _model_lock:
        if _face_app is not None:
            return _face_app
        try:
            from insightface.app import FaceAnalysis  # noqa: WPS433 (deliberate lazy import)
        except Exception as exc:  # pragma: no cover - depends on host install
            _face_app_error = f"import failed: {exc}"
            raise VisionError(
                "MODEL_UNAVAILABLE",
                "insightface is not installed in this environment",
                503,
                hint="Run services/vision/run.sh to create the venv and install requirements.txt",
            ) from exc
        try:
            app = FaceAnalysis(name=EMBED_MODEL_NAME, providers=_providers())
            app.prepare(ctx_id=_ctx_id(), det_size=(DET_SIZE, DET_SIZE))
        except Exception as exc:  # pragma: no cover - depends on model download
            _face_app_error = str(exc)
            raise VisionError(
                "MODEL_LOAD_FAILED",
                f"could not initialise face model '{EMBED_MODEL_NAME}': {exc}",
                503,
                hint="First use downloads ~300MB into ~/.insightface — check network access and disk space.",
            ) from exc
        _face_app = app
        _face_app_error = None
        return _face_app


def get_seg_session(model: Optional[str] = None) -> Any:
    """Load (once, per model name) a rembg session."""
    name = model or DEFAULT_SEG_MODEL
    session = _seg_sessions.get(name)
    if session is not None:
        return session
    with _model_lock:
        session = _seg_sessions.get(name)
        if session is not None:
            return session
        try:
            from rembg import new_session  # noqa: WPS433 (deliberate lazy import)
        except Exception as exc:  # pragma: no cover - depends on host install
            raise VisionError(
                "MODEL_UNAVAILABLE",
                "rembg is not installed in this environment",
                503,
                hint="Run services/vision/run.sh to create the venv and install requirements.txt",
            ) from exc
        try:
            session = new_session(name)
        except Exception as exc:  # pragma: no cover - depends on model download
            raise VisionError(
                "MODEL_LOAD_FAILED",
                f"could not initialise segmentation model '{name}': {exc}",
                503,
                hint="First use downloads the ONNX weights into ~/.u2net — check network access.",
            ) from exc
        _seg_sessions[name] = session
        return session


def model_status() -> Dict[str, Any]:
    """Report load state WITHOUT triggering a load — /health must stay instant."""
    status: Dict[str, Any] = {
        "detector": "loaded" if _face_app is not None else "lazy",
        "embedder": "loaded" if _face_app is not None else "lazy",
        "faceModel": EMBED_MODEL_NAME,
        "segmenter": "loaded" if _seg_sessions else "lazy",
        "segModel": DEFAULT_SEG_MODEL,
        "loadedSegModels": sorted(_seg_sessions.keys()),
        "device": "cuda" if DEVICE in ("cuda", "gpu") else "cpu",
    }
    if _face_app_error:
        status["detector"] = "error"
        status["embedder"] = "error"
        status["faceModelError"] = _face_app_error
    return status


def warm_up() -> Dict[str, Any]:
    """Force both model families to load. Used by the optional /warmup endpoint
    so a caller can pay the cold-start cost before a render starts."""
    result: Dict[str, Any] = {}
    try:
        get_face_app()
        result["face"] = "loaded"
    except VisionError as err:
        result["face"] = f"{err.code}: {err.message}"
    try:
        get_seg_session()
        result["segmentation"] = "loaded"
    except VisionError as err:
        result["segmentation"] = f"{err.code}: {err.message}"
    return result


# ---------------------------------------------------------------------------
# Image IO
# ---------------------------------------------------------------------------


def _decode_base64(blob: str) -> bytes:
    payload = blob.strip()
    if payload.startswith("data:"):
        _, _, payload = payload.partition(",")
    payload = "".join(payload.split())
    # Tolerate unpadded base64 from JS callers.
    padding = (-len(payload)) % 4
    try:
        return base64.b64decode(payload + ("=" * padding), validate=False)
    except (binascii.Error, ValueError) as exc:
        raise VisionError("INVALID_IMAGE", f"image_base64 is not valid base64: {exc}", 400) from exc


def _bytes_to_bgr(raw: bytes, origin: str) -> np.ndarray:
    if not raw:
        raise VisionError("INVALID_IMAGE", f"{origin} decoded to zero bytes", 400)
    buf = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise VisionError("INVALID_IMAGE", f"{origin} is not a decodable image", 400)
    h, w = img.shape[:2]
    if h * w > MAX_PIXELS:
        raise VisionError(
            "IMAGE_TOO_LARGE",
            f"image is {w}x{h} ({w * h} px), limit is {MAX_PIXELS} px",
            413,
            hint="Downscale before sending, or raise HEXA_VISION_MAX_PIXELS.",
        )
    return img


def load_image(
    image_base64: Optional[str] = None,
    image_path: Optional[str] = None,
    image: Optional[str] = None,
) -> np.ndarray:
    """Resolve one of the three accepted input spellings into a BGR uint8 array.

    `image` is the convenience form: an absolute path if it points at a readable
    file, otherwise treated as base64 / a data URI.
    """
    if image and not image_base64 and not image_path:
        candidate = image.strip()
        looks_like_path = (
            len(candidate) < 4096
            and "\n" not in candidate
            and (candidate.startswith("/") or candidate.startswith("~") or candidate[1:3] == ":\\")
        )
        if looks_like_path:
            image_path = candidate
        else:
            image_base64 = candidate

    if image_path:
        path = os.path.expanduser(image_path)
        if not os.path.isabs(path):
            raise VisionError(
                "INVALID_REQUEST",
                "image_path must be absolute — the sidecar has its own working directory",
                400,
            )
        if not os.path.isfile(path):
            raise VisionError("IMAGE_NOT_FOUND", f"no readable file at {path}", 404)
        try:
            with open(path, "rb") as handle:
                raw = handle.read()
        except OSError as exc:
            raise VisionError("IMAGE_NOT_FOUND", f"could not read {path}: {exc}", 404) from exc
        return _bytes_to_bgr(raw, f"file {path}")

    if image_base64:
        return _bytes_to_bgr(_decode_base64(image_base64), "image_base64")

    raise VisionError(
        "INVALID_REQUEST",
        "provide one of image_base64, image_path or image",
        400,
    )


def bgr_to_pil(bgr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))


def encode_png(rgba: np.ndarray) -> bytes:
    """Encode an RGBA uint8 array to PNG bytes."""
    ok, buf = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    if not ok:
        raise VisionError("ENCODE_FAILED", "PNG encoding failed", 500)
    return buf.tobytes()


def to_base64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


# ---------------------------------------------------------------------------
# Detection / pose
# ---------------------------------------------------------------------------

_KP_ORDER = ("leftEye", "rightEye", "nose", "mouthLeft", "mouthRight")


def _landmarks_from_kps(kps: Any) -> Optional[Dict[str, List[float]]]:
    if kps is None:
        return None
    pts = np.asarray(kps, dtype=np.float32).reshape(-1, 2)
    if pts.shape[0] < 5:
        return None
    return {name: [float(pts[i][0]), float(pts[i][1])] for i, name in enumerate(_KP_ORDER)}


def _pose_from_kps(lm: Dict[str, List[float]]) -> Tuple[float, float, float]:
    """Coarse head pose from the 5 keypoints, in degrees.

    Only used when insightface's 3D-landmark pose is unavailable. Convention
    matches insightface: yaw > 0 means the head is turned toward image-right,
    pitch > 0 means chin up, roll > 0 means the head is tilted so the subject's
    right eye sits lower in the frame. This is a projective approximation, good
    to maybe ±10°, and is flagged as such in the response (`poseSource`).
    """
    le = np.array(lm["leftEye"], dtype=np.float64)
    re = np.array(lm["rightEye"], dtype=np.float64)
    nose = np.array(lm["nose"], dtype=np.float64)
    mouth = (np.array(lm["mouthLeft"], dtype=np.float64) + np.array(lm["mouthRight"], dtype=np.float64)) / 2.0
    eye_c = (le + re) / 2.0

    roll = math.degrees(math.atan2(re[1] - le[1], re[0] - le[0]))

    eye_dist = float(np.linalg.norm(re - le))
    if eye_dist < 1e-6:
        return 0.0, 0.0, roll

    # Rotate into a roll-corrected frame so yaw/pitch are not contaminated by tilt.
    ca, sa = math.cos(math.radians(-roll)), math.sin(math.radians(-roll))
    rot = np.array([[ca, -sa], [sa, ca]])
    nose_r = rot @ (nose - eye_c)
    mouth_r = rot @ (mouth - eye_c)

    # Nose tip protrudes ~0.55 * interocular distance out of the eye plane, so
    # the horizontal nose offset over the (foreshortened) eye distance is
    # 0.55 * tan(yaw).
    yaw = math.degrees(math.atan2(nose_r[0] / eye_dist, 0.55))

    # Vertically the nose tip sits ~58% of the way from the eye line to the
    # mouth line on a level head; deviation from that ratio reads as pitch.
    eye_mouth = float(abs(mouth_r[1]))
    if eye_mouth < 1e-6:
        pitch = 0.0
    else:
        ratio = float(nose_r[1]) / eye_mouth
        pitch = math.degrees(math.atan2(0.58 - ratio, 0.35))

    clamp = lambda v: float(max(-89.0, min(89.0, v)))  # noqa: E731
    return clamp(pitch), clamp(yaw), clamp(roll)


def _face_record(face: Any, shape: Tuple[int, int]) -> Dict[str, Any]:
    h, w = shape
    bbox = np.asarray(face.bbox, dtype=np.float64).reshape(-1)
    x1 = float(max(0.0, min(bbox[0], w)))
    y1 = float(max(0.0, min(bbox[1], h)))
    x2 = float(max(0.0, min(bbox[2], w)))
    y2 = float(max(0.0, min(bbox[3], h)))
    score = float(getattr(face, "det_score", 0.0) or 0.0)
    lm = _landmarks_from_kps(getattr(face, "kps", None))

    pose = getattr(face, "pose", None)
    pose_source = "landmark_3d_68"
    if pose is not None:
        arr = np.asarray(pose, dtype=np.float64).reshape(-1)
        pitch, yaw, roll = float(arr[0]), float(arr[1]), float(arr[2])
    elif lm is not None:
        pitch, yaw, roll = _pose_from_kps(lm)
        pose_source = "keypoint_approx"
    else:
        pitch = yaw = roll = 0.0
        pose_source = "unavailable"

    return {
        # Pixel coordinates in the SOURCE image's own resolution — the TS client
        # and @hexa/core's FaceBox use the same convention.
        "box": {
            "x": round(x1, 2),
            "y": round(y1, 2),
            "w": round(max(0.0, x2 - x1), 2),
            "h": round(max(0.0, y2 - y1), 2),
            "confidence": round(score, 4),
        },
        "confidence": round(score, 4),
        "landmarks": lm,
        "yaw": round(yaw, 2),
        "pitch": round(pitch, 2),
        "roll": round(roll, 2),
        "poseSource": pose_source,
    }


def _face_sort_key(rec: Dict[str, Any]) -> float:
    box = rec["box"]
    return float(box["w"]) * float(box["h"]) * (0.5 + 0.5 * float(rec["confidence"]))


def detect_faces(bgr: np.ndarray, max_faces: Optional[int] = None, min_confidence: float = 0.0) -> List[Dict[str, Any]]:
    """Detect faces, largest-and-most-confident first. Element 0 is the
    'primary' face every other endpoint operates on."""
    app = get_face_app()
    with _infer_lock:
        try:
            faces = app.get(bgr)
        except Exception as exc:  # pragma: no cover - runtime model failure
            raise VisionError("DETECTION_FAILED", f"face detection failed: {exc}", 500) from exc
    records = [_face_record(f, bgr.shape[:2]) for f in faces]
    records = [r for r in records if r["confidence"] >= min_confidence and r["box"]["w"] > 1 and r["box"]["h"] > 1]
    records.sort(key=_face_sort_key, reverse=True)
    if max_faces is not None and max_faces > 0:
        records = records[:max_faces]
    return records


def _primary_face(bgr: np.ndarray) -> Any:
    app = get_face_app()
    with _infer_lock:
        try:
            faces = app.get(bgr)
        except Exception as exc:  # pragma: no cover - runtime model failure
            raise VisionError("DETECTION_FAILED", f"face detection failed: {exc}", 500) from exc
    if not faces:
        raise VisionError(
            "NO_FACE",
            "no face detected in the supplied image",
            422,
            hint="Use a portrait-style reference where the face is at least ~64px wide.",
        )
    shape = bgr.shape[:2]
    scored = sorted(faces, key=lambda f: _face_sort_key(_face_record(f, shape)), reverse=True)
    return scored[0]


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------


def _normed_vector(face: Any) -> np.ndarray:
    vec = getattr(face, "normed_embedding", None)
    if vec is None:
        vec = getattr(face, "embedding", None)
    if vec is None:
        raise VisionError(
            "NO_EMBEDDING",
            "the loaded face model produced no recognition embedding",
            500,
            hint=f"Expected the '{EMBED_MODEL_NAME}' bundle, which includes the ArcFace recognition head.",
        )
    arr = np.asarray(vec, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(arr))
    if norm < 1e-8:
        raise VisionError("NO_EMBEDDING", "degenerate (zero-length) embedding", 500)
    return arr / norm


def embed_primary(bgr: np.ndarray) -> Dict[str, Any]:
    face = _primary_face(bgr)
    vec = _normed_vector(face)
    rec = _face_record(face, bgr.shape[:2])
    return {
        "embedding": [float(v) for v in vec.tolist()],
        "model": EMBED_MODEL_NAME,
        "faceBox": rec["box"],
        "landmarks": rec["landmarks"],
        "yaw": rec["yaw"],
        "pitch": rec["pitch"],
        "roll": rec["roll"],
    }


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    va = np.asarray(a, dtype=np.float32).reshape(-1)
    vb = np.asarray(b, dtype=np.float32).reshape(-1)
    if va.shape != vb.shape:
        raise VisionError("INVALID_REQUEST", f"embedding dimension mismatch: {va.shape} vs {vb.shape}", 400)
    na = float(np.linalg.norm(va))
    nb = float(np.linalg.norm(vb))
    if na < 1e-8 or nb < 1e-8:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def similarity(bgr_a: np.ndarray, bgr_b: np.ndarray) -> Dict[str, Any]:
    a = embed_primary(bgr_a)
    b = embed_primary(bgr_b)
    return {
        "similarity": round(cosine(a["embedding"], b["embedding"]), 6),
        "model": EMBED_MODEL_NAME,
        "faceBoxA": a["faceBox"],
        "faceBoxB": b["faceBox"],
    }


# ---------------------------------------------------------------------------
# Bust framing
# ---------------------------------------------------------------------------


def bust_rect(
    lm: Dict[str, List[float]],
    shape: Tuple[int, int],
    shoulder_ratio: float = 1.9,
    width_ratio: float = 2.05,
    bottom_pad: float = 0.18,
    crown_pad: float = 0.12,
) -> Tuple[int, int, int, int]:
    """Head-and-shoulders crop derived from face landmarks, in real proportions.

    A naive "expand the detector box by 40%" crop is what makes cheap versus
    graphics look wrong: the detector box tracks the *face*, not the *head*, so
    the crown gets sliced and the chin floats. Instead we rebuild the head from
    anthropometry:

      * eye line sits at ~0.50 of crown->chin height,
      * mouth line sits at ~0.79 of it,
        => eye-to-mouth distance ~= 0.29 * headHeight, so headHeight ~= 3.42 * emd,
      * the shoulder line is ~`shoulder_ratio` (default 1.9) head-heights below
        the crown,
      * biacromial (shoulder) width is ~2 head widths ~= 1.5 head heights; we
        frame a little wider (`width_ratio`, default 2.05 head heights) so the
        deltoids are not clipped by the cutout edge.

    Returns an (x, y, w, h) rect in source pixels, clamped to the image.
    """
    h, w = shape
    le = np.array(lm["leftEye"], dtype=np.float64)
    re = np.array(lm["rightEye"], dtype=np.float64)
    mouth = (np.array(lm["mouthLeft"], dtype=np.float64) + np.array(lm["mouthRight"], dtype=np.float64)) / 2.0
    eye_c = (le + re) / 2.0

    emd = float(np.linalg.norm(mouth - eye_c))
    if emd < 1e-3:
        # Degenerate landmarks — fall back to interocular distance, which is
        # ~0.32 head-heights wide on a frontal face.
        emd = max(1.0, float(np.linalg.norm(re - le))) * 0.9
    head_h = 3.42 * emd

    # Down-axis of the head: eyes -> mouth, which tracks roll for free.
    down = mouth - eye_c
    down_norm = float(np.linalg.norm(down))
    down = down / down_norm if down_norm > 1e-6 else np.array([0.0, 1.0])

    crown = eye_c - down * (0.50 * head_h) - down * (crown_pad * head_h)
    bottom = crown + down * ((shoulder_ratio + bottom_pad) * head_h)

    cx = float((crown[0] + bottom[0]) / 2.0)
    box_w = width_ratio * head_h
    x0 = cx - box_w / 2.0
    y0 = float(min(crown[1], bottom[1]))
    y1 = float(max(crown[1], bottom[1]))

    x = int(round(max(0.0, x0)))
    y = int(round(max(0.0, y0)))
    x2 = int(round(min(float(w), x0 + box_w)))
    y2 = int(round(min(float(h), y1)))
    if x2 - x < 8 or y2 - y < 8:
        raise VisionError(
            "BUST_CROP_FAILED",
            "computed bust rect fell outside the image",
            422,
            hint="The subject is probably too close to an edge — send a wider source photo or set bust:false.",
        )
    return x, y, x2 - x, y2 - y


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------


def _edge_refine(rgb: np.ndarray, alpha: np.ndarray, radius: int = 4, eps: float = 1e-3) -> np.ndarray:
    """Snap the matte back onto real image edges.

    rembg's alpha matting already produces soft hair, but the transition band is
    computed on a downscaled trimap, so strands drift a pixel or two off the
    photo's own edges. A guided filter with the RGB frame as guide pulls the
    matte back onto those edges. cv2.ximgproc (contrib) is optional, so we fall
    back to a joint-bilateral, then to a plain bilateral on the alpha.

    The refine is applied only inside the transition band (where alpha is
    neither fully 0 nor fully 255) so solid interior stays solid.
    """
    a_f = alpha.astype(np.float32) / 255.0
    guide = rgb.astype(np.float32) / 255.0

    refined: Optional[np.ndarray] = None
    ximgproc = getattr(cv2, "ximgproc", None)
    if ximgproc is not None:
        try:
            refined = ximgproc.guidedFilter(guide, a_f, radius, eps)
        except Exception:
            refined = None
        if refined is None:
            try:
                refined = ximgproc.jointBilateralFilter(guide, a_f, -1, 0.08, float(radius * 2))
            except Exception:
                refined = None
    if refined is None:
        refined = cv2.bilateralFilter(a_f, -1, 0.08, float(radius * 2))

    refined = np.clip(refined, 0.0, 1.0)

    band = ((alpha > 2) & (alpha < 253)).astype(np.float32)
    band = cv2.dilate(band, np.ones((3, 3), np.uint8), iterations=max(1, radius // 2))
    band = cv2.GaussianBlur(band, (0, 0), 1.0)
    out = a_f * (1.0 - band) + refined * band
    return np.clip(out * 255.0, 0, 255).astype(np.uint8)


def _decontaminate(rgb: np.ndarray, alpha: np.ndarray, radius: int = 6) -> np.ndarray:
    """Remove the background colour halo bleeding into semi-transparent pixels.

    At a hair edge the captured pixel is a mix of hair and backdrop. Compositing
    that raw pixel over a new backdrop keeps a ring of the OLD backdrop — the
    classic "cut out in Paint" look. We estimate the pure foreground colour as
    the alpha-weighted local average of confidently-foreground pixels and blend
    it in proportionally to how transparent the pixel is.
    """
    a = (alpha.astype(np.float32) / 255.0)[:, :, None]
    core2d = (alpha >= 250).astype(np.float32)
    core = core2d[:, :, None]
    k = max(3, radius * 2 + 1)
    num = cv2.blur(rgb.astype(np.float32) * core, (k, k))
    # cv2 drops the trailing singleton axis on 1-channel input, so put it back
    # explicitly rather than relying on a broadcast that would not happen.
    den = cv2.blur(core2d, (k, k))[:, :, None]
    est = num / np.maximum(den, 1e-4)
    valid = (den > 1e-3).astype(np.float32)
    mix = (1.0 - a) * valid
    out = rgb.astype(np.float32) * (1.0 - mix) + est * mix
    return np.clip(out, 0, 255).astype(np.uint8)


def segment(
    bgr: np.ndarray,
    bust: bool = False,
    feather: float = 0.0,
    alpha_matting: bool = True,
    fg_threshold: int = 240,
    bg_threshold: int = 12,
    erode: int = 8,
    model: Optional[str] = None,
    edge_refine: bool = True,
    decontaminate: bool = True,
    shoulder_ratio: float = 1.9,
) -> Dict[str, Any]:
    """RGBA cutout with alpha matting, optionally framed as a bust.

    Returns a dict with the PNG bytes plus what actually happened, so the caller
    can tell a real bust crop from a silent fallback.
    """
    warnings: List[str] = []
    crop = None
    bust_applied = False
    work = bgr

    if bust:
        try:
            faces = detect_faces(bgr, max_faces=1)
            if not faces or not faces[0].get("landmarks"):
                raise VisionError("NO_FACE", "no face landmarks available for bust framing", 422)
            crop = bust_rect(faces[0]["landmarks"], bgr.shape[:2], shoulder_ratio=shoulder_ratio)
            x, y, w, h = crop
            work = bgr[y : y + h, x : x + w]
            bust_applied = True
        except VisionError as err:
            # Segmentation is still useful without the bust framing; say so
            # rather than failing the whole request.
            warnings.append(f"bust framing skipped ({err.code}): {err.message}")

    try:
        from rembg import remove  # noqa: WPS433 (deliberate lazy import)
    except Exception as exc:  # pragma: no cover - depends on host install
        raise VisionError(
            "MODEL_UNAVAILABLE",
            "rembg is not installed in this environment",
            503,
            hint="Run services/vision/run.sh to create the venv and install requirements.txt",
        ) from exc

    session = get_seg_session(model)
    pil = bgr_to_pil(work)
    kwargs: Dict[str, Any] = {"session": session}
    if alpha_matting:
        kwargs.update(
            alpha_matting=True,
            alpha_matting_foreground_threshold=int(max(0, min(255, fg_threshold))),
            alpha_matting_background_threshold=int(max(0, min(255, bg_threshold))),
            alpha_matting_erode_size=int(max(0, erode)),
        )
    with _infer_lock:
        try:
            cut = remove(pil, **kwargs)
        except Exception as exc:
            if alpha_matting:
                # pymatting can blow up on very small or very flat inputs; a
                # hard matte still beats no cutout at all.
                warnings.append(f"alpha matting failed ({exc}); fell back to hard matte")
                try:
                    cut = remove(pil, session=session)
                except Exception as exc2:
                    raise VisionError("SEGMENTATION_FAILED", f"rembg failed: {exc2}", 500) from exc2
            else:
                raise VisionError("SEGMENTATION_FAILED", f"rembg failed: {exc}", 500) from exc

    rgba = np.array(cut.convert("RGBA"), dtype=np.uint8)
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]

    if edge_refine:
        alpha = _edge_refine(rgb, alpha)
    if feather and feather > 0:
        # Feather AFTER the edge refine: refine sharpens onto true edges, then
        # feather deliberately softens by a known amount for compositing.
        alpha = cv2.GaussianBlur(alpha, (0, 0), float(feather))
    if decontaminate:
        rgb = _decontaminate(rgb, alpha)

    out = np.dstack([rgb, alpha]).astype(np.uint8)
    png = encode_png(out)
    coverage = float((alpha.astype(np.float32) / 255.0).mean())
    if coverage < 0.01:
        warnings.append("matte is almost entirely transparent — the subject may not have been found")
    elif coverage > 0.985:
        warnings.append("matte is almost entirely opaque — no background was removed")

    result: Dict[str, Any] = {
        "png": png,
        "width": int(out.shape[1]),
        "height": int(out.shape[0]),
        "bust_applied": bust_applied,
        "alpha_matting": bool(alpha_matting),
        "coverage": round(coverage, 4),
        "warnings": warnings,
    }
    if crop is not None and bust_applied:
        result["crop"] = {"x": crop[0], "y": crop[1], "w": crop[2], "h": crop[3]}
    return result


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def _palette(bgr: np.ndarray, k: int = 5) -> List[str]:
    small = cv2.resize(bgr, (96, 96), interpolation=cv2.INTER_AREA)
    data = small.reshape(-1, 3).astype(np.float32)
    k = int(max(1, min(k, 8)))
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    try:
        _, labels, centers = cv2.kmeans(data, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    except Exception:  # pragma: no cover - kmeans is robust but not infallible
        mean = data.mean(axis=0)
        return ["#{:02x}{:02x}{:02x}".format(int(mean[2]), int(mean[1]), int(mean[0]))]
    counts = np.bincount(labels.reshape(-1), minlength=k)
    order = np.argsort(-counts)
    out: List[str] = []
    for idx in order:
        b, g, r = centers[idx]
        out.append("#{:02x}{:02x}{:02x}".format(int(np.clip(r, 0, 255)), int(np.clip(g, 0, 255)), int(np.clip(b, 0, 255))))
    return out


def _skin_mask(bgr: np.ndarray) -> np.ndarray:
    """YCrCb skin plausibility mask. Same Cb 77-127 / Cr 133-173 window the
    TypeScript fallback locator uses, kept in sync on purpose."""
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    y, cr, cb = ycrcb[:, :, 0], ycrcb[:, :, 1], ycrcb[:, :, 2]
    return ((cb >= 77) & (cb <= 127) & (cr >= 133) & (cr <= 173) & (y >= 40)).astype(np.uint8)


def _occlusion(bgr: np.ndarray, rec: Optional[Dict[str, Any]]) -> Optional[float]:
    """0-1 estimate of how much of the face is blocked (hand, mic, hair, mask).

    HEURISTIC, not a trained occlusion classifier. Three cheap signals:
      1. skin coverage inside the face box — a mic or hand pushes it down,
      2. detector confidence deficit — partial faces score lower,
      3. left/right asymmetry of skin coverage — a hand on one cheek is very
         asymmetric, whereas a hat or shadow is not.
    Good enough to rank candidate references; not good enough to be a gate.
    """
    if rec is None:
        return None
    box = rec["box"]
    x, y, w, h = int(box["x"]), int(box["y"]), int(box["w"]), int(box["h"])
    x, y = max(0, x), max(0, y)
    w = min(w, bgr.shape[1] - x)
    h = min(h, bgr.shape[0] - y)
    if w < 8 or h < 8:
        return None
    patch = bgr[y : y + h, x : x + w]
    mask = _skin_mask(patch)
    cov = float(mask.mean())
    left = float(mask[:, : w // 2].mean())
    right = float(mask[:, w - w // 2 :].mean())
    asym = abs(left - right) / max(1e-3, max(left, right))

    # A clean frontal face covers ~0.72 of its own detector box with skin.
    cov_penalty = float(np.clip((0.72 - cov) / 0.72, 0.0, 1.0))
    conf_penalty = float(np.clip(1.0 - float(rec["confidence"]), 0.0, 1.0))
    asym_penalty = float(np.clip(asym, 0.0, 1.0))
    score = 0.60 * cov_penalty + 0.25 * conf_penalty + 0.15 * asym_penalty
    return round(float(np.clip(score, 0.0, 1.0)), 4)


def compute_metrics(bgr: np.ndarray, palette_size: int = 5, with_face: bool = True) -> Dict[str, Any]:
    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    scale = SHARPNESS_LONG_EDGE / float(max(h, w))
    gray_n = gray if scale >= 1.0 else cv2.resize(gray, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    lap = cv2.Laplacian(gray_n, cv2.CV_64F)
    sharpness = float(lap.var())

    out: Dict[str, Any] = {
        "width": int(w),
        "height": int(h),
        "sharpness": round(sharpness, 3),
        "brightness": round(float(gray.mean()), 3),
        "contrast": round(float(gray.std()) / 255.0, 5),
        "palette": _palette(bgr, palette_size),
        "warnings": [],
    }

    if not with_face:
        return out

    try:
        faces = detect_faces(bgr, max_faces=1)
    except VisionError as err:
        # Pure-CV metrics are still valid without the face model; the TS client
        # merges whatever it gets.
        out["warnings"].append(f"face metrics unavailable ({err.code}): {err.message}")
        return out

    if not faces:
        out["warnings"].append("no face detected")
        return out

    rec = faces[0]
    box = rec["box"]
    out["faceBox"] = box
    out["landmarks"] = rec["landmarks"]
    out["faceArea"] = round(float(box["w"] * box["h"]) / float(max(1, w * h)), 6)
    out["yaw"] = rec["yaw"]
    out["pitch"] = rec["pitch"]
    out["roll"] = rec["roll"]
    occ = _occlusion(bgr, rec)
    if occ is not None:
        out["occlusion"] = occ
    return out
