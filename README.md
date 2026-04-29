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
manga_reader/
├── backend/            # FastAPI application
│   ├── routes/         # API route handlers (home, catalog, manga, bookmarks)
│   ├── auth.py         # JWT auth, user management
│   ├── database.py     # PostgreSQL connection pool
│   ├── editors_choice.py
│   ├── helpers.py
│   ├── suwayomi.py     # Suwayomi GraphQL client
│   ├── sync.py         # Background sync from Suwayomi → Postgres
│   ├── cache.py        # In-memory TTL cache
│   └── main.py         # App entry point
├── frontend/           # React Router v7 SSR app
│   ├── app/
│   │   ├── routes/     # File-based routes
│   │   ├── components/ # Shared UI components (Navbar, MangaCard, icons)
│   │   └── lib/        # Shared utilities (config, utils, auth.server)
│   └── ...
└── infrastructure/
    └── docker-compose.yml   # Suwayomi + PostgreSQL
```

---

## Prerequisites

- Node.js 20+
- Python 3.11+
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

# Optional: set env vars (defaults work for local dev)
export DATABASE_URL="postgresql://manga:manga@localhost:5432/manga_db"
export JWT_SECRET="your-secret-key"

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
| `DATABASE_URL` | `postgresql://manga:manga@localhost:5432/manga_db` | PostgreSQL connection string |
| `JWT_SECRET` | random (generated at startup) | Secret key for signing JWTs — set a fixed value in production |

> **Note:** If `JWT_SECRET` is not set, a random key is generated each time the server starts, which will invalidate all existing sessions on restart.

---

## Features

- Browse, search and read manga from 80+ sources
- Full-text search with live Suwayomi fallback for new titles
- User accounts with bookmarks
- Editor's Choice section managed from the admin panel
- Auto-advancing sliders (Popular, Editor's Pick)
- Chapter reader with configurable width modes
- Admin panel for curating featured picks
