# =============================================================================
# ai-service/Dockerfile
# =============================================================================
FROM python:3.11-slim

WORKDIR /app

# ── System dependencies ────────────────────────────────────────────────────────
# build-essential: needed by some Python packages (e.g. tokenizers)
# git + git-lfs: needed to pull model_files tracked by Git LFS
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        git \
        git-lfs \
    && git lfs install \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ────────────────────────────────────────────────────────
# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install PyTorch CPU build first (large wheel — separate layer helps caching)
RUN pip install --no-cache-dir \
    torch \
    --extra-index-url https://download.pytorch.org/whl/cpu

# Install remaining requirements
RUN pip install --no-cache-dir \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

# ── Application source ────────────────────────────────────────────────────────
# Includes app/model_files/ — make sure Git LFS files are checked out locally
# before building the image (run `git lfs pull` in the repo first)
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
