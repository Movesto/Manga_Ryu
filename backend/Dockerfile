# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Install all Python dependencies into an isolated venv.
# Build tools (gcc, etc.) stay here and never reach the final image.
FROM python:3.12-slim AS builder

# Build the venv at its FINAL runtime path so console-script shebangs
# (e.g. .venv/bin/uvicorn → #!/app/.venv/bin/python) stay valid after copy.
WORKDIR /app
RUN python -m venv /app/.venv

# INSTALL_ML=false skips the ML tagger deps (torch etc., ~1.5 GB) — use it for
# memory-constrained hosts; tagger.py degrades gracefully when they're absent.
ARG INSTALL_ML=true

COPY requirements.txt requirements-ml.txt ./

RUN .venv/bin/pip install --no-cache-dir --upgrade pip setuptools>=78.1.1 msgpack>=1.2.1 \
 && .venv/bin/pip install --no-cache-dir -r requirements.txt \
 && if [ "$INSTALL_ML" = "true" ]; then \
      .venv/bin/pip install --no-cache-dir -r requirements-ml.txt; \
    fi


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# Lean final image: no build tools, no pip, no root process.
FROM python:3.12-slim AS runtime

# Strip the vulnerable global packages baked into the base Python image
RUN python -m pip uninstall -y pip setuptools wheel

# Locked-down system account — no shell, no home directory, no login
RUN useradd --system --no-create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

# Only the compiled venv comes from the builder — nothing else
COPY --from=builder /app/.venv /app/.venv

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

# Invoke via `python -m uvicorn` so startup never depends on a console-script
# shebang. --proxy-headers trusts X-Forwarded-For from the reverse proxy /
# tunnel; --forwarded-allow-ips * is safe because that proxy is the only entry.
CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]