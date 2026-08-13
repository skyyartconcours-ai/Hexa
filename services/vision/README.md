# Hexa vision sidecar

A small FastAPI service that gives Hexa real computer vision: face detection,
ArcFace identity embeddings, head pose, alpha-matted subject cutouts and image
quality metrics.

**This service is OPTIONAL.** Hexa runs without Python installed at all.
`@hexa/vision` probes `/health` once, memoises the answer, and falls back to
pure-TypeScript heuristics when nothing answers. What you lose by not running it
is described in [What degrades without it](#what-degrades-without-it) — the
short version is that **identity verification stops working**, and cutout
quality drops from "hair survives compositing" to "clean backdrops only".

```bash
./run.sh                      # venv + install + serve on 127.0.0.1:8765
HEXA_VISION_PORT=9000 ./run.sh
./run.sh --reinstall          # force a dependency reinstall
curl -s localhost:8765/health | jq
```

First run downloads ~500MB of wheels and, on first *real* request, ~350MB of
model weights into `~/.insightface` and `~/.u2net`. `/health` stays instant
regardless: **no model is loaded at import time or by the health probe.**

---

## Why it exists

Hexa's product guarantee is that "Peyz vs Viper" renders the actual Peyz and the
actual Viper. That is enforced mechanically, not by hoping the generative model
behaves:

1. Real reference photos are segmented here (`/segment`) and composited.
2. The finished render's face region is embedded here (`/embed`) and compared
   against the player's reference embeddings.
3. If cosine similarity falls below the identity threshold, the render is
   rejected.

Step 2 has no TypeScript equivalent. A 512-d ArcFace embedding is the mechanism;
there is no cheap approximation of it, which is why `VisionClient.similarity()`
throws `VISION_UNAVAILABLE` instead of guessing when this service is down.

---

## Endpoints

All bodies are JSON. Images are supplied as **one of**:

| field          | meaning                                                     |
| -------------- | ----------------------------------------------------------- |
| `image_base64` | raw base64 or a `data:image/png;base64,...` URI              |
| `image_path`   | absolute path readable *by the sidecar process*              |
| `image`        | either of the above; absolute paths are auto-detected        |

The TS client sends `image_path` when the endpoint is loopback (same filesystem,
no base64 tax) and `image_base64` otherwise.

All coordinates are **pixels in the source image's own resolution**, matching
`FaceBox` / `FaceLandmarks` in `@hexa/core`. EXIF orientation is applied on both
sides (`cv2.imdecode` and `sharp.rotate()`), so the two paths agree.

### `GET /health`

```json
{
  "status": "ok",
  "models": {
    "detector": "lazy", "embedder": "lazy", "faceModel": "buffalo_l",
    "segmenter": "lazy", "segModel": "isnet-general-use",
    "loadedSegModels": [], "device": "cpu"
  },
  "version": "0.1.0"
}
```

`detector`/`segmenter` are `lazy` (not loaded yet), `loaded`, or `error` with
`faceModelError` explaining why. `status` stays `ok` whenever the *process* is
healthy even if a model failed — segmentation may still work when recognition
does not, and the client latches per-capability rather than switching everything
off. Never triggers a model load.

### `POST /warmup`

Loads both model families up front so the first real render does not pay the
cold start. Reports per-family success as a string; never fails the request.

### `POST /detect`

`{image_base64, max_faces?, min_confidence?}` →

```json
{"faces": [{
  "box": {"x": 412.0, "y": 96.5, "w": 188.2, "h": 241.7, "confidence": 0.94},
  "confidence": 0.94,
  "landmarks": {"leftEye": [..], "rightEye": [..], "nose": [..],
                "mouthLeft": [..], "mouthRight": [..]},
  "yaw": -7.4, "pitch": 3.1, "roll": 1.2, "poseSource": "landmark_3d_68"
}], "width": 1920, "height": 1080, "model": "buffalo_l"}
```

Faces are sorted largest-and-most-confident first; `faces[0]` is the "primary"
face every other endpoint operates on. `poseSource` is `landmark_3d_68` when the
real 3D-landmark pose is available, `keypoint_approx` when it was reconstructed
geometrically from the 5 keypoints (±10°, documented in `_pose_from_kps`).

Sign convention: `yaw > 0` head turned toward image-right, `pitch > 0` chin up,
`roll > 0` tilt.

### `POST /embed`

`{image_base64}` → `{embedding: number[512], model: "buffalo_l", faceBox, landmarks, yaw, pitch, roll}`

L2-normalised, so a plain dot product is the cosine. `422 NO_FACE` when there is
nothing to embed.

### `POST /embed_batch`

`{images: [{image_base64}, ...], fail_fast?: false}` →
`{embeddings: [ {...} | null ], errors: [ {code, message} | null ], model}`

Output length and order always match the input. By default one bad image yields
a `null` entry rather than failing the batch; `fail_fast: true` reverses that.

### `POST /similarity`

`{a: {image_base64}, b: {image_path}}` →
`{similarity: 0.6421, model, faceBoxA, faceBoxB}`

Cosine between the two images' primary faces. This is the identity gate.

### `POST /segment`

`{image_base64, bust?, feather?, alpha_matting?, fg_threshold?, bg_threshold?, erode?, model?, edge_refine?, decontaminate?, shoulder_ratio?}` →

```json
{"png_base64": "...", "width": 900, "height": 1400, "bust_applied": true,
 "alpha_matting": true, "coverage": 0.41, "crop": {...}, "warnings": []}
```

| param             | default             | what it does |
| ----------------- | ------------------- | ------------ |
| `bust`            | `false`             | reframe head-and-shoulders from landmarks before matting |
| `alpha_matting`   | `true`              | closed-form matting via pymatting — this is the hair setting |
| `fg_threshold`    | `240`               | above this alpha, a pixel is definitely foreground in the trimap |
| `bg_threshold`    | `12`                | below this, definitely background |
| `erode`           | `8`                 | trimap erode size; larger = wider "unknown" band = softer, slower |
| `feather`         | `0`                 | Gaussian sigma applied to alpha *after* edge refinement |
| `edge_refine`     | `true`              | guided-filter snap of the matte onto real image edges |
| `decontaminate`   | `true`              | strip background colour bleed from semi-transparent pixels |
| `model`           | `isnet-general-use` | or `u2net`, `u2netp`, `isnet-anime`, ... |
| `shoulder_ratio`  | `1.9`               | shoulder line in head-heights below the crown |

**Why this much machinery for a cutout.** Cheap cutouts look fake in exactly two
places: hair edges and colour halos. rembg alone gives a soft-ish alpha computed
on a downscaled trimap, so strands sit a pixel or two off the photo's real edges;
`edge_refine` pulls them back with a guided filter (falling back to joint
bilateral, then bilateral, if `cv2.ximgproc` is not installed), applied only
inside the transition band so solid interior stays solid. `decontaminate` then
fixes the second problem: a hair-edge pixel is a *mix* of hair and old backdrop,
and compositing it unchanged keeps a ring of the old background around your
subject. It re-estimates the pure foreground colour as the alpha-weighted local
average of confidently-foreground pixels and blends it in proportionally to
transparency. Measured on a synthetic mixed edge, that moves edge pixels 39%
closer to the true foreground colour.

**Bust framing** (`bust: true`) does not expand the detector box by a magic
percentage — that slices the crown and floats the chin, because the detector box
tracks the *face*, not the *head*. It rebuilds the head from anthropometry
(`bust_rect` in `pipeline.py`):

- eye line at ~0.50 of crown→chin, mouth line at ~0.79, so eye-to-mouth ≈ 0.29
  head-heights and **headHeight ≈ 3.42 × eye-to-mouth distance**;
- crown = eye centre − 0.5 headHeights along the eye→mouth axis (which tracks
  roll for free), plus a small margin;
- shoulder line at `shoulder_ratio` (1.9) head-heights below the crown;
- frame width 2.05 head-heights, a little wider than biacromial width so the
  deltoids are not clipped.

If no face is found, segmentation still runs on the full frame and says so in
`warnings` and `bust_applied: false` rather than failing the request.

### `POST /metrics`

`{image_base64, palette_size?: 5, with_face?: true}` → the `AssetMetrics` fields
this service can measure:

```json
{"width": 1920, "height": 1080, "sharpness": 132.4, "brightness": 118.7,
 "contrast": 0.21, "palette": ["#141e3c", ...], "faceBox": {...},
 "landmarks": {...}, "faceArea": 0.084, "yaw": -7.4, "pitch": 3.1, "roll": 1.2,
 "occlusion": 0.07, "warnings": []}
```

- `sharpness` is variance-of-Laplacian measured on a long-edge-1024 copy, so the
  "<40 is soft" rule in `@hexa/core` means the same thing for a 900px press crop
  and a 6000px raw frame. The TS fallback uses the identical kernel and the same
  normalisation; measured agreement on a test image was **0.8%**.
- `occlusion` is a **heuristic**, not a trained classifier: skin coverage inside
  the face box, detector-confidence deficit, and left/right coverage asymmetry.
  Good enough to rank candidate references, not good enough to gate on.
- `quality` is deliberately *not* returned. Composite scoring belongs to
  `@hexa/assets`, which weights these numbers against what a layout slot needs.
- Face metrics degrade independently: with no recognition model you still get
  width/height/sharpness/brightness/contrast/palette plus a `warnings` entry.

---

## Errors

Every failure — validation, missing model, unknown route, unexpected crash — is
answered as a structured body with a real HTTP status. A traceback never reaches
the client; it is logged server-side.

```json
{"error": {"code": "NO_FACE", "message": "no face detected in the supplied image",
           "hint": "Use a portrait-style reference where the face is at least ~64px wide."}}
```

| code                | status | meaning |
| ------------------- | ------ | ------- |
| `INVALID_REQUEST`   | 400/422| bad or missing fields, relative `image_path`, out-of-range param |
| `INVALID_IMAGE`     | 400    | not decodable |
| `IMAGE_NOT_FOUND`   | 404    | `image_path` does not exist |
| `NOT_FOUND` / `METHOD_NOT_ALLOWED` | 404/405 | routing |
| `IMAGE_TOO_LARGE`   | 413    | over `HEXA_VISION_MAX_PIXELS` (default 64MP) |
| `NO_FACE`           | 422    | nothing to embed / no landmarks for a bust crop |
| `BUST_CROP_FAILED`  | 422    | computed bust rect fell outside the image |
| `MODEL_UNAVAILABLE` | 503    | insightface/rembg not installed |
| `MODEL_LOAD_FAILED` | 503    | weights could not be downloaded or initialised |
| `SEGMENTATION_FAILED` / `DETECTION_FAILED` / `INTERNAL_ERROR` | 500 | unexpected |

The TS client maps `MODEL_UNAVAILABLE`/`MODEL_LOAD_FAILED` to
`HexaError('VISION_UNAVAILABLE')` — from a caller's point of view a running
sidecar with no model is still "no vision" — and latches that capability off for
60s so a batch render does not pay a 503 per asset.

---

## What degrades without it

`@hexa/vision` probes `/health` once (memoised, ≤1.5s, never throws) and picks a
path per call.

| call                    | sidecar running                                                | sidecar absent |
| ----------------------- | -------------------------------------------------------------- | -------------- |
| `available()`           | `true`                                                          | `false`, fast — connection refusal, memoised for 10s |
| `detectFaces()`         | SCRFD boxes, 5-pt landmarks, 3D head pose, confidence 0.7–0.95   | YCbCr skin-blob guess, **confidence capped at 0.4**, no landmarks, no pose, `[]` when unsure |
| `embed()` / `embedBatch()` | 512-d ArcFace vectors                                        | **`null`** — no approximation is attempted |
| `similarity()`          | cosine of two primary faces                                     | **throws `HexaError('VISION_UNAVAILABLE')`** with a hint pointing at `run.sh` |
| `segment()`             | rembg + alpha matting + guided-filter refine + decontamination; `bust` from landmarks | border-seeded chroma/luma key with edge feathering; `bust` framed from the heuristic box |
| `metrics()`             | all fields incl. pose and occlusion                             | width/height/sharpness/brightness/contrast/palette identical to the sidecar; heuristic `faceBox`/`faceArea`; **pose and occlusion omitted, not guessed** |

The fallback face locator is a skin-tone blob finder (Chai & Ngan YCbCr window,
Cb 77–127 / Cr 133–173) with morphological cleanup, connected-component
labelling and aspect/compactness sanity checks. It is wrong in entirely ordinary
situations — bare arms, wooden stage furniture, warm tungsten backlight, two
players in one frame — and it exists so layout code has *a* focal point instead
of crashing. It cannot tell you **who** is in the picture. Its confidence is
hard-capped at 0.4 so nothing downstream mistakes it for a real detection.

**Identity verification requires this sidecar.** There is no partial credit.

### The identity threshold

`DEFAULT_IDENTITY_THRESHOLD = 0.45` (exported from `@hexa/vision`).

ArcFace embeddings are L2-normalised, so cosine ∈ [-1, 1]. Impostor pairs (two
different people) cluster near 0 with a thin tail reaching ~0.35; genuine pairs
(same person, different photo) sit around 0.6–0.8 for clean captures.
Recall-optimised defaults sit far lower — DeepFace's ArcFace default is cosine
distance 0.68, i.e. similarity 0.32 — because they want to *find* matches. A
gate wants the opposite: false accepts are the expensive error, so it sits above
the impostor tail, not on top of it. But it cannot sit at 0.6 either, because
this comparison is cross-domain — a reference photograph against a relit,
colour-graded, composited render, which costs roughly 0.05–0.15 of cosine even
when the identity is objectively correct. 0.45 clears the impostor tail by ~0.10
and leaves ~0.15 of grading headroom. Raise it for publish-grade jobs, lower it
for drafts.

Compare against the *best* of a player's gallery (`bestSimilarity`), not the
centroid alone: one bad reference angle should not sink a correct render.

---

## Configuration

| env var                   | default             | |
| ------------------------- | ------------------- | - |
| `HEXA_VISION_HOST` / `_PORT` | `127.0.0.1` / `8765` | bind address |
| `HEXA_VISION_DEVICE`      | `cpu`               | `cuda` selects the CUDA execution provider (install `onnxruntime-gpu`) |
| `HEXA_VISION_FACE_MODEL`  | `buffalo_l`         | insightface bundle |
| `HEXA_VISION_SEG_MODEL`   | `isnet-general-use` | rembg model |
| `HEXA_VISION_DET_SIZE`    | `640`               | detector input size |
| `HEXA_VISION_MAX_PIXELS`  | `67108864`          | decompression-bomb guard |
| `HEXA_VISION_LOG`         | `INFO`              | log level |
| `HEXA_VISION_VENV`        | `./.venv`           | venv location used by `run.sh` |

On the TypeScript side, `HEXA_VISION_ENDPOINT` overrides the default
`http://127.0.0.1:8765`, and `HEXA_VISION_CACHE_DIR` / `HEXA_CACHE_DIR` control
where detections and embeddings are cached.

Inference is serialised behind a lock: ONNX sessions are not safe to call
concurrently from several threads, and this is a single-user local helper where
correctness beats throughput.

### Docker

```bash
docker build -t hexa-vision services/vision
docker run --rm -p 8765:8765 \
  -v "$HOME/.insightface:/models/.insightface" \
  -v "$HOME/.u2net:/models/.u2net" \
  -v "$PWD/assets:/assets:ro" \
  hexa-vision
```

Mount the model caches or every container start re-downloads the weights. Mount
the asset library read-only if you want `image_path` to work — paths must be
absolute *inside* the container.

---

## What was and was not runtime-verified

Built and checked in a container without the heavy ML dependencies, so be
precise about the state of the evidence.

**Verified by running it:**

- `python3 -m py_compile` on both `.py` files; `bash -n run.sh`.
- The full FastAPI surface under `fastapi.testclient`, with `insightface` and
  `rembg` absent: `/health` responds in <10ms and does not load models;
  `/warmup`, `/metrics` (with and without `with_face`), `/embed_batch` with an
  empty list; structured error bodies with the right codes and statuses for
  unknown route, wrong method, missing body field, empty body, bad base64,
  missing file, relative path, out-of-range param, and all five
  model-dependent endpoints returning `503 MODEL_UNAVAILABLE`; and a forced
  unexpected exception returning `500 INTERNAL_ERROR` with no traceback in the
  body.
- Every `pipeline.py` function that does not need insightface/rembg, against
  real OpenCV/NumPy/Pillow: image loading in all input spellings and all four
  error paths; `compute_metrics` (including "blur lowers sharpness" and the
  face-model-missing degradation); `_edge_refine`; `_decontaminate` (edge pixels
  end 39% closer to the true foreground colour, opaque interior untouched);
  `encode_png`/`to_base64` round-trip through `cv2.imdecode`; `_pose_from_kps`
  (frontal ≈ 0, yaw sign and magnitude, roll from the eye line); `bust_rect`
  proportions and its degenerate-crop rejection; `cosine`; `_occlusion` (rises
  when the face is covered); `model_status`; `warm_up`.
- End-to-end against a live `uvicorn` process on port 8791 driven by the real
  TypeScript `VisionClient`: health probe and model-name capture, `/metrics`
  over the wire with both `image_base64` and `image_path`, sidecar-vs-fallback
  metric agreement (sharpness 0.8%, brightness 0.5%), graceful fallback on 503,
  the per-capability latch (second pass 5ms, zero round trips), and
  `similarity()` raising `VISION_UNAVAILABLE`.

**NOT verified — no runtime evidence:**

- Anything requiring `insightface` or `rembg`: actual face detection, real
  ArcFace embeddings and their numeric range, real head pose from
  `landmark_3d_68`, rembg segmentation, and pymatting alpha matting. These
  packages were not installed (~500MB of wheels plus ~350MB of weights). The
  code paths are written against the documented APIs but have not executed.
- `run.sh`'s venv creation and `pip install` (syntax-checked only), and the
  Dockerfile (never built).
- CUDA / `onnxruntime-gpu`.
- `cv2.ximgproc.guidedFilter` — not present in `opencv-python-headless`, so the
  guided-filter branch of `_edge_refine` was exercised only through its
  bilateral fallback. Both branches are guarded by `try/except`.
- The pinned dependency set as a whole. `requirements.txt` pins `numpy<2.0` for
  insightface's 1.x ABI; local verification ran against NumPy 2.4, OpenCV 4.12
  and Pillow 12, which exercised the same code paths but is not the pinned
  combination.

The first thing to do on a machine with the dependencies installed is
`./run.sh` then `POST /warmup`, and confirm `/health` reports
`"detector": "loaded"`.
