# syntax=docker/dockerfile:1
#
# The previous single-stage image ran as root, kept build-essential and g++ in the final
# layer, resolved `torch>=2.4` to the multi-gigabyte CUDA wheel on CPU-only hosts, baked
# in no model weights (so ~900 MB was downloaded on the first job after every
# --force-recreate, synchronously, while /health happily reported 200), and had no
# healthcheck or init.

# ─── Builder ─────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

# The build toolchain lives only in this stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    g++ \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch by default. The default index resolves torch to a CUDA build that pulls
# several gigabytes of nvidia-* packages, which is dead weight on a CPU host — and on a
# GPU host the CUDA version should be chosen deliberately. Override at build time:
#   --build-arg TORCH_INDEX_URL=https://pypi.org/simple
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --index-url "${TORCH_INDEX_URL}" \
    --extra-index-url https://pypi.org/simple torch

COPY pyproject.toml ./
COPY src/ src/
RUN pip install --no-cache-dir .

# ─── Model weights ───────────────────────────────────────────────────────────
# Downloaded at build time so the image is self-contained and the first job does not
# stall for minutes. Also makes the build reproducible: a running container no longer
# depends on an external model host being reachable.
FROM builder AS models

ENV HF_HOME=/opt/models/hf \
    INSIGHTFACE_HOME=/opt/models/insightface \
    TORCH_HOME=/opt/models/torch

RUN mkdir -p /opt/models && python - <<'PY'
import open_clip
from insightface.app import FaceAnalysis

# Same identifiers as the worker/config.py defaults. Building with different values only
# means the first job re-downloads — a cache miss, not an error.
open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"]).prepare(
    ctx_id=-1, det_size=(640, 640)
)
print("model weights cached")
PY

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Runtime libraries only: ffmpeg for transcoding, the rest for Pillow and OpenCV. No
# compilers.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    libheif1 \
    tini \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/opt/models/hf \
    INSIGHTFACE_HOME=/opt/models/insightface \
    TORCH_HOME=/opt/models/torch

# Unprivileged user; PID 1 was previously root.
RUN useradd --create-home --shell /usr/sbin/nologin worker

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY --from=models --chown=worker:worker /opt/models /opt/models

WORKDIR /app
COPY --chown=worker:worker src/ src/
COPY --chown=worker:worker pyproject.toml ./

USER worker

EXPOSE 8001

# /readyz, not /health: readiness reports whether the models are actually resident, so an
# orchestrator does not route work to an instance that cannot yet process anything.
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/readyz', timeout=4).status == 200 else 1)"

# tini reaps zombies (ffmpeg subprocesses) and forwards SIGTERM, so the lifespan shutdown
# path actually runs and in-flight jobs are released rather than killed outright.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "worker.main"]
