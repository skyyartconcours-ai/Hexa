# Optional container for the Hexa vision sidecar.
#
#   docker build -t hexa-vision services/vision
#   docker run --rm -p 8765:8765 \
#     -v "$HOME/.insightface:/models/.insightface" \
#     -v "$HOME/.u2net:/models/.u2net" \
#     -v "$PWD/assets:/assets:ro" \
#     hexa-vision
#
# Mount the model caches (second/third -v) or every container start re-downloads
# ~350MB of weights. Mount your asset library read-only if you want to use
# `image_path` instead of base64 — paths must be absolute *inside* the container.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HEXA_VISION_HOST=0.0.0.0 \
    HEXA_VISION_PORT=8765 \
    INSIGHTFACE_HOME=/models/.insightface \
    U2NET_HOME=/models/.u2net

# opencv-python-headless still needs libglib; onnxruntime needs libgomp.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/vision

COPY requirements.txt ./
RUN python -m pip install --upgrade pip wheel \
 && python -m pip install -r requirements.txt

COPY pipeline.py app.py ./

RUN mkdir -p /models/.insightface /models/.u2net

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8765/health || exit 1

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765"]
