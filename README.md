# Manga Ryu

A self-hosted manga reader running live at **[mangaryu.org](https://mangaryu.org)**.
It aggregates 80+ sources through a [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server)
engine, serves them through a FastAPI API and a server-rendered React frontend,
and ships with the security posture of a production service — CSRF protection,
tiered rate limiting, audit logging, a nonce-based CSP, and a CI pipeline that
scans every commit and deploys the exact images it scanned.

---

## Features

- **Read anything** — browse, search, and read manga/manhwa/manhua from 80+
  sources, with full-text search and a live fallback for titles not yet synced
- **Accounts** — bookmarks with unread badges, reading history with
  *Continue Reading*, cross-device sessions that renew silently
- **Reader** — configurable width modes, swipe navigation, chapter downloads
  as Kindle EPUB, PDF, or a self-contained offline HTML reader
- **Curation** — admin panel with Editor's Choice picks, AniList-powered
  ratings, auto-advancing showcase sliders
- **ML auto-tagging** — a sentence-transformer classifier fills in missing
  genre tags for poorly-tagged sources (trained in `ml/`, inference optional)
- **PWA** — installable, with a mobile-tuned reading experience

## How it works

```
Browser ──> Cloudflare Tunnel ──> React Router v7 (SSR, node)
                                     │  /api/* proxy · /media/* image cache
                                     ▼
                                  FastAPI ──> PostgreSQL 16
                                     │
                                     ▼
                                  Suwayomi engine ──> 80+ manga sources
```

| Layer | Technology |
|---|---|
| Frontend | React Router v7 (SSR), TypeScript, Tailwind CSS v4 |
| Backend API | FastAPI (Python 3.12), psycopg2 |
| Database | PostgreSQL 16 |
| Manga engine | Suwayomi Server |
| Auth | JWT — 30-min access + rotating refresh tokens, HttpOnly cookies |
| ML | sentence-transformers + scikit-learn genre classifier |
| Ingress | Cloudflare Tunnel (no inbound ports, TLS at the edge) |

---

## Deployment

The whole production setup is one command on a fresh Ubuntu VM (built for
Oracle Cloud's free `VM.Standard.E2.1.Micro`, 1 GB RAM):

```bash
curl -fsSL https://raw.githubusercontent.com/Movesto/Manga_Ryu/main/infrastructure/oracle-setup.sh | bash
```

The script is idempotent and does everything: swap file, Docker, repo
checkout, secret generation, Cloudflare Tunnel prompt, image pull from GHCR,
launch, and health checks. When it finishes, it tells you the two remaining
clicks (tunnel hostname → `frontend:3000`, register the first account —
it becomes admin).

Every push to `main` then deploys automatically: CI builds the images, scans
them with Trivy, pushes them to GHCR, and the VM pulls and restarts — the
scanned artifact **is** the deployed artifact.

Details, sizing rationale, and troubleshooting:
[`infrastructure/ORACLE_DEPLOY.md`](infrastructure/ORACLE_DEPLOY.md)

---

## Local development

Prerequisites: Docker, Python 3.12+, Node 22+.

```bash
# 1. Infrastructure (Suwayomi :4567 + PostgreSQL :5432)
cd infrastructure
cp .env.example .env               # set POSTGRES_PASSWORD + JWT_SECRET
docker compose up -d suwayomi postgres

# 2. Backend (http://localhost:8000)
cd ../backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env               # set JWT_SECRET (backend loads .env itself)
uvicorn main:app --port 8000 --reload

# 3. Frontend (http://localhost:5173)
cd ../frontend
npm install
npm run dev
```

Quality gates — the same ones CI runs on every push:

```bash
cd backend  && ruff check . && pytest tests/
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

All configuration is documented in `backend/.env.example` and
`infrastructure/.env.example`; the reference table is at the bottom of this
file.

---

## Security

This project doubles as a DevSecOps portfolio (see
[`CHALLENGES.md`](CHALLENGES.md)). What's implemented:

- **Auth**: bcrypt passwords, 30-minute access tokens, single-use rotating
  refresh tokens stored hashed, login timing-oracle mitigation, brute-force
  rate limits, audit logging of all auth and admin events
- **Web**: double-submit CSRF with constant-time comparison, nonce-based CSP
  (no `unsafe-inline` scripts), HSTS, same-origin checks on the API proxy,
  session cookies never forwarded upstream
- **Pipeline** (`.github/workflows/`): Gitleaks over full history, Semgrep
  SAST, pip-audit + npm audit SCA, Trivy container scanning on both images —
  all gating deploys; Dependabot across pip, npm, Docker, and Actions
- **Runtime**: non-root multi-stage containers, per-service memory caps,
  required-secret enforcement (the backend refuses to boot without
  `JWT_SECRET`), tunnel-only ingress with zero open inbound ports

---

## ML genre tagger

Sources often ship manga with missing or junk genre tags. The `ml/` pipeline
trains a multi-label classifier (MiniLM sentence embeddings → one-vs-rest
logistic regression) on well-tagged titles from the database, and the backend
applies it to untagged manga during sync — predictions never overwrite
source-provided genres.

```bash
cd ml
pip install -r requirements.txt
python extract_data.py       # pull training data from the DB → data.csv
python train_tagger.py       # train, evaluate, save model + metrics.json
```

Deploy the resulting `ml/model/` next to the backend and set
`TAGGER_MODEL_DIR`. Inference is optional everywhere — without a model the
backend simply skips tagging. (It stays disabled on the 1 GB production VM;
torch doesn't fit.)

---

## Project structure

```
Manga_Ryu/
├── backend/                 # FastAPI application
│   ├── routes/              # home, catalog, manga, download, html_reader
│   ├── tests/               # pytest suite
│   ├── auth.py              # JWT auth, refresh rotation, user management
│   ├── audit.py             # security audit logging
│   ├── database.py          # connection pool + schema
│   ├── sync.py / suwayomi.py# catalog sync + Suwayomi GraphQL client
│   ├── tagger.py            # ML genre tagger (inference)
│   └── main.py              # app entry point
├── frontend/                # React Router v7 SSR app
│   └── app/
│       ├── routes/          # file-based routes, /api and /media proxies
│       ├── components/      # Navbar, MangaCard, icons
│       └── lib/             # auth.server, csrf.server, config, utils
├── ml/                      # tagger training pipeline
├── infrastructure/
│   ├── docker-compose.yml       # local dev stack
│   ├── docker-compose.prod.yml  # production stack + Cloudflare Tunnel
│   ├── oracle-setup.sh          # one-command VM bootstrap
│   └── ORACLE_DEPLOY.md         # deployment runbook
└── .github/workflows/       # ci.yml (quality) + security.yml (scans + deploy)
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | **required** | JWT signing key — the server refuses to start without it |
| `POSTGRES_PASSWORD` | **required** (Docker) | Database password (use hex — it's interpolated into `DATABASE_URL`) |
| `TUNNEL_TOKEN` | **required** (prod) | Cloudflare Tunnel connector token |
| `DATABASE_URL` | `postgresql://manga:manga@localhost:5432/manga_db` | PostgreSQL connection string |
| `SUWAYOMI_URL` | `http://127.0.0.1:4567` | Suwayomi server base URL |
| `ACCESS_TOKEN_MINUTES` | `30` | Access-token lifetime (sessions renew via refresh token) |
| `REFRESH_TOKEN_DAYS` | `30` | Refresh-token lifetime |
| `IMAGE_TAG` | `latest` | GHCR image tag to deploy (pin to a commit SHA to roll back) |
| `KCC_PATH` | empty (disabled) | Path to `kcc-c2e` for Kindle EPUB conversion |
| `TAGGER_MODEL_DIR` | `../ml/model` | Trained genre-tagger model directory |
| `TAGGER_THRESHOLD` | `0.30` | Tagger confidence cutoff (0–1) |
