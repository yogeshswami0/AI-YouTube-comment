# =============================================================================
# rag/Dockerfile
# =============================================================================
FROM python:3.11-slim

WORKDIR /app

# ── System dependencies ────────────────────────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ────────────────────────────────────────────────────────
# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install PyTorch CPU build first (large wheel — separate layer helps caching)
RUN pip install --no-cache-dir \
    torch==2.4.1 \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining requirements (torch is already satisfied — pip skips it)
RUN pip install --no-cache-dir -r requirements.txt

# ── Application source ────────────────────────────────────────────────────────
COPY . .

# ── Port ──────────────────────────────────────────────────────────────────────
EXPOSE 8001

# ── Startup: queue consumer (background) + uvicorn (foreground) ───────────────
CMD ["sh", "-c", "python -m app.worker.queue_consumer & uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
