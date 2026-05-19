FROM python:3.12-slim

# System dependencies for Pillow, ffmpeg, and InsightFace
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    g++ \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
COPY src/ src/
RUN pip install --no-cache-dir .

EXPOSE 8001

CMD ["python", "-m", "worker.main"]
