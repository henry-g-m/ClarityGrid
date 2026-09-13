# ClarityGrid

A synthetic electric-grid pricing/billing prototype: 8 fictional US locations,
seeded hourly wholesale prices and building usage, a tariff calc engine, and
a battery peak-shaving simulator. Ported from the React artifact in
`ui_prototype/` into a FastAPI + Postgres backend.

See [`PLAN.md`](PLAN.md) for the full architecture and phased plan, and
[`docs/`](docs/) for the Clarity Grid Solutions API reference this project's
route shapes are modeled on.

## Project layout

```
backend/       FastAPI app, calc engine, DB schema + seed script (see below)
docs/          Clarity Grid Solutions API documentation (reference, not code)
ui_prototype/  React client UI — talks to the backend's /api/* routes over HTTP
```

`ui_prototype/` is a thin client: it no longer generates prices, usage, or
bills itself. Every location, tariff, price, usage, and bill number shown in
the UI comes from a call to the `backend` service (see `/api/*` in
[`backend/app/routers/app_api.py`](backend/app/routers/app_api.py)). This is
a minimal Vite scaffold around the original artifact component, not the full
Phase 2 stack (TypeScript/Tailwind/shadcn/TanStack Query) described in
[`PLAN.md`](PLAN.md) — that remains future work.

## Backend setup

### Prerequisites

| Tool | Why |
|---|---|
| Python 3.11+ | `backend/pyproject.toml` requires it |
| [`uv`](https://docs.astral.sh/uv/) | Dependency manager + runner for this project |
| A reachable Postgres database | The app has no in-memory fallback — see below |
| Azure CLI (`az`), logged in | Only needed if you're provisioning/managing the Postgres server itself |

### Install

```bash
cd backend
uv sync --group dev
```

This installs the runtime dependencies (FastAPI, uvicorn, pydantic, psycopg,
psycopg-pool, python-dotenv) plus dev-only ones (pytest, httpx).

### Configure the database connection

```bash
cp backend/.env.example backend/.env
# then edit backend/.env and fill in DATABASE_URL
```

`backend/.env` (gitignored) must define:

```
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<db>?sslmode=require
```

`app/config.py` loads this via `python-dotenv` on import. Without it,
`init_pool()` raises `RuntimeError: DATABASE_URL is not set` at startup.

### Schema + synthetic data

`backend/scripts/schema.sql` defines the tables (`locations`, `tariffs`,
`price_series`, `usage_series`). `backend/scripts/seed_db.py` creates them
and loads a full year of synthetic data using the same generators the app
uses at runtime, so the DB and the calc engine stay consistent:

```bash
cd backend
uv run python scripts/seed_db.py
```

Safe to re-run — it truncates and reloads every table.

### Run

```bash
cd backend
uv run uvicorn app.main:app --reload
```

Then `GET http://127.0.0.1:8000/health` should return `{"status": "ok"}`,
and `GET /api/locations` should return the 8 seeded locations.

### Test

```bash
cd backend
uv run pytest
```

Note: the route tests spin up the app with its real `lifespan`, which opens
a connection pool against whatever `DATABASE_URL` points to — there's no
mock or local test DB yet, so `pytest` needs network access to a live,
seeded database to pass.

## Accessing the UI

The UI lives in `ui_prototype/` and requires the backend to be running (it
fetches all of its data from `/api/*` — see above).

### Prerequisites

| Tool | Why |
|---|---|
| Node.js 18+ and npm | Runs the Vite dev server |
| The backend, running locally on port 8000 | The UI's `API_BASE` defaults to `http://localhost:8000` |

### Install and run

```bash
cd ui_prototype
npm install
npm run dev
```

Vite will print a local URL (typically `http://localhost:5173`) — open it in
a browser. With the backend also running (`uv run uvicorn app.main:app
--reload` from `backend/`, per above), you should see the 8 seeded locations
on the map, real tariff estimates, and a KPI/chart view that updates as you
change location, building type, usage, tariff, or the battery/fixed-rate/
compare what-ifs.

If the backend isn't reachable, the page shows a "Could not reach the
backend at http://localhost:8000" error instead of the loading map — start
or fix the backend and reload.

To point the UI at a different backend (e.g. a deployed instance), set
`window.__CLARITYGRID_API_BASE__` before the app mounts — e.g. add
`<script>window.__CLARITYGRID_API_BASE__ = "https://your-backend-host";</script>`
to `ui_prototype/index.html` above the `main.jsx` script tag.
