# ClarityGrid

A synthetic electric-grid pricing/billing prototype: 8 fictional US locations,
seeded hourly wholesale prices and building usage, a tariff calc engine, and
a battery peak-shaving simulator. Ported from the React artifact in
`ui_prototype/` into a FastAPI + Postgres backend.

See [`PLAN.md`](PLAN.md) for the full architecture and phased plan, and
[`docs/`](docs/) for the Clarity Grid Solutions API reference this project's
route shapes are modeled on, plus this project's own operational docs (e.g.
[observability](docs/OPS-0001-observability.md) and
[stress-testing plan](docs/OPS-0002-stress-testing.md)).

## Project layout

```
backend/       FastAPI app, calc engine, DB schema + seed script (see below)
docs/          Clarity Grid Solutions API reference, plus this project's ADRs/ops docs
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

`backend/.env.example` also documents two optional observability env vars
(`APPLICATIONINSIGHTS_CONNECTION_STRING`, `LOG_LEVEL`) — leave both unset for
local dev; see [`docs/OPS-0001-observability.md`](docs/OPS-0001-observability.md).

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

To point the local dev server at a different backend, set `VITE_API_BASE_URL`
(e.g. in `ui_prototype/.env.local`) or, for a quick one-off override without
rebuilding, set `window.__CLARITYGRID_API_BASE__` before the app mounts. The
app checks `VITE_API_BASE_URL` first, then the `window` global, then falls
back to `http://localhost:8000`.

## Deploying to Azure

This repo is an [`azd`](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
project (`azure.yaml` + `infra/main.bicep`) with two services:

| Service | Azure resource | What it is |
|---|---|---|
| `backend` | Container App | The FastAPI app from `backend/` (Docker) |
| `frontend` | Static Web App | The Vite build of `ui_prototype/` |

### One-time setup

```bash
azd auth login
azd env new dev        # or `azd env select dev` if it already exists
azd env set DATABASE_URL "postgresql://<user>:<password>@<host>:5432/<db>?sslmode=require"
```

### Provision + deploy

```bash
azd up
```

This provisions both resources (Log Analytics, Container Apps environment,
ACR, the backend Container App, and the Static Web App) and deploys both
services. After it finishes, `azd env get-values` will show `BACKEND_URL`
and `FRONTEND_URL` — open `FRONTEND_URL` in a browser to use the deployed UI.

To redeploy code without re-provisioning infra: `azd deploy` (both services)
or `azd deploy frontend` / `azd deploy backend` for just one.

### How the pieces are wired together

- **CORS**: the backend's `CLARITYGRID_CORS_ORIGINS` env var is set in Bicep
  to the Static Web App's own URL (`https://${staticWebApp.properties.defaultHostname}`),
  so only the deployed frontend's origin can call `/api/*` and `/ecservice/*`
  from a browser. This is provisioning-time wiring — no manual step needed.
- **API base URL**: Vite inlines env vars into the built JS at build time, so
  the frontend needs to know the backend's URL *before* Vite builds. npm's own
  `build` script (`ui_prototype/package.json`) runs `write-build-env.mjs`
  first, which writes `VITE_API_BASE_URL=$BACKEND_URL` to
  `.env.production.local` — `$BACKEND_URL` comes from the backend's Bicep
  output, forwarded through as an env var by whatever invokes `npm run build`
  (CI, or `azd deploy` locally). This used to be an `azd` `prebuild` hook, but
  that hook never actually ran for this staticwebapp-hosted service during
  `azd deploy` — silently, no error — so the deployed bundle always shipped
  with its `http://localhost:8000` fallback baked in and every request from a
  real visitor's browser went to their own machine instead of Azure. Folding
  it into npm's `build` script guarantees it runs.
- **Observability**: the backend ships with logging, distributed tracing, and
  metrics via OpenTelemetry (see `backend/app/observability.py`), exported to
  a workspace-based Application Insights resource that `infra/main.bicep`
  provisions on the same Log Analytics workspace used for container console
  logs — no manual wiring needed after `azd provision`/`azd up`. Full
  reference, including what's instrumented and how to query it:
  [`docs/OPS-0001-observability.md`](docs/OPS-0001-observability.md).

### CI/CD

`.github/workflows/azure-dev.yml` builds and tests both services on every
push/PR to `main`, then (push to `main` only) runs `azd provision` and
`azd deploy` for both. The `provision` job explicitly forwards `BACKEND_URL`
to the `deploy` job (each GitHub Actions job is a fresh checkout with no
local `azd` environment state, so outputs from `azd provision` don't
automatically carry over — see the existing `acr_endpoint` handling in that
workflow for the same pattern).
