# Manga Ryu

A self-hosted manga reader that aggregates content from dozens of sources via a [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server) backend, backed by a FastAPI API and a React Router v7 frontend.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React Router v7 (SSR), TypeScript, Tailwind CSS v4 |
| Backend API | FastAPI (Python), psycopg2 |
| Database | PostgreSQL 16 |
| Manga engine | Suwayomi Server (aggregates 80+ sources) |
| Auth | JWT — access + refresh tokens in HttpOnly cookies |

---

## Project structure

```
Manga_Ryu/
├── backend/            # FastAPI application
│   ├── routes/         # API route handlers (home, catalog, manga, download, html_reader)
│   ├── tests/          # pytest suite
│   ├── auth.py         # JWT auth, user management
│   ├── audit.py        # Security audit logging
│   ├── database.py     # PostgreSQL connection pool + schema
│   ├── bookmarks.py / history.py / ratings.py / editors_choice.py
│   ├── ratelimit.py    # SlowAPI rate limiter
│   ├── suwayomi.py     # Suwayomi GraphQL client
│   ├── sync.py         # Background sync from Suwayomi → Postgres
│   ├── tagger.py       # ML genre tagger (inference)
│   ├── cache.py        # In-memory TTL cache
│   └── main.py         # App entry point
├── frontend/           # React Router v7 SSR app
│   ├── app/
│   │   ├── routes/     # File-based routes (incl. /api and /media proxies)
│   │   ├── components/ # Shared UI components (Navbar, MangaCard, icons)
│   │   └── lib/        # Shared utilities (config, utils, auth.server, csrf.server)
│   └── ...
├── ml/                 # Genre tagger training pipeline (extract_data, train_tagger)
├── infrastructure/
│   ├── docker-compose.yml        # Local dev: Suwayomi + PostgreSQL + backend
│   ├── docker-compose.prod.yml   # Production: full stack + Cloudflare Tunnel
│   ├── oracle-setup.sh           # One-command Oracle Cloud VM bootstrap
│   └── ORACLE_DEPLOY.md          # Production deployment runbook
└── .github/workflows/  # CI (lint/test/build) + security pipeline (SAST/SCA/Trivy/deploy)
```

---

## Prerequisites

- Node.js 22+
- Python 3.12+
- Docker & Docker Compose
- PostgreSQL 16 (or use Docker)

---

## Getting started

### 1. Start infrastructure (Suwayomi + PostgreSQL)

```bash
cd infrastructure
docker compose up -d
```

Suwayomi will be available at `http://localhost:4567`.
PostgreSQL will be available on port `5432`.

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# Optional — only needed to run the ML genre tagger locally:
# pip install -r requirements-ml.txt

# REQUIRED — the server refuses to start without it:
export JWT_SECRET="$(python -c 'import secrets; print(secrets.token_hex(32))')"
# Optional (default shown):
export DATABASE_URL="postgresql://manga:manga@localhost:5432/manga_db"

uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

API is available at `http://localhost:8000`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App is available at `http://localhost:5173`.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | **required** | Secret key for signing JWTs — the server **refuses to start** without it. Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `DATABASE_URL` | `postgresql://manga:manga@localhost:5432/manga_db` | PostgreSQL connection string |
| `SUWAYOMI_URL` | `http://127.0.0.1:4567` | Base URL of the Suwayomi server |
| `ACCESS_TOKEN_MINUTES` | `30` | Access-token lifetime (kept short; the frontend renews sessions via the refresh token) |
| `REFRESH_TOKEN_DAYS` | `30` | Refresh-token lifetime |
| `POSTGRES_PASSWORD` | **required** (Docker) | Database password, injected by docker-compose |
| `KCC_PATH` | empty (disabled) | Absolute path to the `kcc-c2e` binary for Kindle EPUB downloads |
| `TAGGER_MODEL_DIR` | `../ml/model` | Directory with the trained genre-tagger model |
| `TAGGER_THRESHOLD` | `0.30` | Tagger prediction confidence cutoff (0–1) |

See `backend/.env.example` and `infrastructure/.env.example` for copy-paste templates.

---

## Features

- Browse, search and read manga from 80+ sources
- Full-text search with live Suwayomi fallback for new titles
- User accounts with bookmarks
- Editor's Choice section managed from the admin panel
- Auto-advancing sliders (Popular, Editor's Pick)
- Chapter reader with configurable width modes
- Admin panel for curating featured picks

---

## Development

```bash
# Backend — lint and tests
cd backend
pip install -r requirements-dev.txt
ruff check .
pytest tests/

# Frontend — lint, typecheck, tests, build
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
```

Both run automatically in CI (`.github/workflows/ci.yml`), alongside the
security pipeline (`security.yml`: Gitleaks, Semgrep, pip-audit, npm audit, Trivy).

---

## Production deployment (Oracle Cloud)

The production stack runs on an Oracle Cloud Always Free VM behind a
Cloudflare Tunnel — no inbound ports, TLS at the Cloudflare edge. One command
on a fresh Ubuntu VM does the entire setup (swap, Docker, checkout, secrets,
launch):

```bash
curl -fsSL https://raw.githubusercontent.com/Movesto/Manga_Ryu/main/infrastructure/oracle-setup.sh | bash
```

- Images are built and Trivy-scanned by CI, pushed to GHCR
  (`manga-ryu-backend`, `manga-ryu-frontend`), and pulled on the VM — the
  scanned artifact is the deployed artifact.
- Pushes to `main` auto-deploy via `docker compose pull && up -d` once all
  security jobs pass (repo secrets: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`).
- Sized for a 1 GB `VM.Standard.E2.1.Micro`: per-service memory caps, bounded
  JVM heap, 2 GB swap, and the ML tagger excluded from the image.

Full runbook: [`infrastructure/ORACLE_DEPLOY.md`](infrastructure/ORACLE_DEPLOY.md)
