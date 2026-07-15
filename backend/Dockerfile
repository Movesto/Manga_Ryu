# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Install all Python dependencies into an isolated venv.
# Build tools (gcc, etc.) stay here and never reach the final image.
FROM python:3.12-slim AS builder

WORKDIR /build

# Create the venv that will be copied into the runtime stage
RUN python -m venv /build/.venv

COPY requirements.txt requirements-ml.txt ./
RUN .venv/bin/pip install --no-cache-dir --upgrade pip \
 && .venv/bin/pip install --no-cache-dir -r requirements.txt -r requirements-ml.txt


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# Lean final image: no build tools, no pip, no root process.
FROM python:3.12-slim AS runtime

# Locked-down system account — no shell, no home directory, no login
RUN useradd --system --no-create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

# Only the compiled venv comes from the builder — nothing else
COPY --from=builder /build/.venv /app/.venv

# Copy application source with correct ownership in one layer
COPY --chown=appuser:appuser . .

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Override at runtime with -e SUWAYOMI_URL=http://suwayomi:4567
    SUWAYOMI_URL="http://127.0.0.1:4567" \
    # Set -e KCC_PATH=/path/to/kcc-c2e to enable Kindle downloads
    # (empty = the endpoint returns 503 instead of failing mid-job)
    KCC_PATH=""

USER appuser

EXPOSE 8000

# --proxy-headers trusts X-Forwarded-For from the nginx reverse proxy.
# --forwarded-allow-ips * is safe here because nginx is the only entry point.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
