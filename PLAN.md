# ClarityGrid Client Backend — Plan

Status: draft for review. No code yet — this is the architecture and sequencing
document. Built to be read by both humans and Claude Code sessions that will
implement it.

## 1. Decisions made so far

| Question | Decision |
|---|---|
| Database | PostgreSQL (standard, no extensions required for now) |
| Development | Claude Code, in a real repo (not the Claude.ai artifact sandbox) |
| Deployment target | Azure |
| Language/framework | Python + FastAPI |

## 2. Decisions I'm defaulting on — flag if you want these changed

You didn't click through the three follow-up questions from last time, so I'm
picking the most defensible default for each and stating it plainly. Push
back on any of these and I'll revise before we start building.

1. **API shape: Hybrid.** Two route groups:
   - `/ecservice/*` — mirrors the real Clarity Grid API's paths and response
     shapes (from the docs we crawled), for fidelity and as a genuine "mock
     API" you could point other real-API-shaped tooling at.
   - `/api/*` — a clean, purpose-built set of endpoints for the ClarityGrid
     Client UI
     itself (simpler shapes, does in one call what the real API needs several
     calls for).
2. **Data generation: pre-generate + cache.** The 8 synthetic locations'
   price series are generated once at startup and cached in memory (they're
   deterministic — same seed in, same series out — so there's no reason to
   recompute per request). Usage series depend on (building type, monthly
   kWh) which is user-chosen, so those are generated on demand and cached by
   that key for the life of the process.
3. **Auth: none, for now.** This is a prototype behind your own Azure
   resources, not a multi-tenant public API. I'm designing the route
   structure so an API-key header or the real login/session-cookie mock can
   be dropped in later without reshaping anything.

## 3. Scope of this backend

**Reference implementation:** `reference/claritygrid-client-app.jsx` (the
current Claude.ai artifact, renamed from its working title "Loadpoint" — the
component inside is now `ClarityGridClientApp`). Treat it as the source of
truth for exact constants, formulas, and behavior — the prose below
describes what each piece does, but the file has the actual seeded values
and the battery/tariff math as debugged and validated. Port from it, don't
re-derive it from this description.

Port the calculation engine and synthetic dataset that currently live as
JavaScript inside the ClarityGrid Client React artifact into a standalone Python
service, so the UI becomes a thin client over a real API instead of doing
everything client-side. Concretely, the backend owns:

- The 8 synthetic locations, their ISOs, utilities, and tariffs (ported
  from the artifact's `LOCATIONS` / `buildTariffs`)
- Hourly wholesale price generation per ISO (`generateHourlyPrices`)
- Hourly usage generation per building type (`generateHourlyUsage`)
- The bill calculation engine (`calculateBill`, `fixedPriceBill`) —
  including the basis-code logic described in `05-basis-reference.md`
- The battery peak-shaving simulator (`simulateBattery`,
  `findShaveCeiling`) — including the state-of-charge and per-day
  water-filling logic we debugged into the current version

This is a faithful port, not a rewrite — the numbers the backend produces
should match what the artifact currently computes client-side, so swapping
the UI over to it is a wiring change, not a behavior change.

## 4. Proposed project structure

```
claritygrid-client/
├── azure.yaml                  # azd project descriptor
├── infra/                      # Bicep, provisioned by azd
│   ├── main.bicep
│   └── ...
├── backend/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── app/
│   │   ├── main.py             # FastAPI() instance, CORS, router mounting, startup cache warm-up
│   │   ├── config.py           # pydantic-settings: env vars, DB URL, CORS origins
│   │   ├── data/
│   │   │   ├── iso_profiles.py       # ISO_PROFILES
│   │   │   ├── locations.py          # LOCATIONS (8 synthetic locations)
│   │   │   ├── building_profiles.py  # BUILDING_SHAPES
│   │   │   └── tariffs.py            # build_tariffs(location) -> list[Tariff]
│   │   ├── models/
│   │   │   ├── domain.py       # dataclasses: Location, Tariff, Charge, TimePeriod...
│   │   │   └── schemas.py      # Pydantic request/response models for the routes
│   │   ├── services/
│   │   │   ├── price_gen.py    # generate_hourly_prices()
│   │   │   ├── usage_gen.py    # generate_hourly_usage()
│   │   │   ├── calc_engine.py  # calculate_bill(), fixed_price_bill(), evaluate_tiered_range()
│   │   │   ├── battery.py      # simulate_battery(), find_shave_ceiling()
│   │   │   └── cache.py        # in-memory series cache
│   │   └── routers/
│   │       ├── real_api.py     # /ecservice/* (login, distributor, distributors/tariffs, calculate_custom_economy, operators)
│   │       └── app_api.py      # /api/* (locations, bill, compare, building-types)
│   └── tests/
│       ├── test_calc_engine.py
│       ├── test_battery.py
│       └── test_routes.py
└── frontend/                    # Phase 2 — ClarityGrid Client UI moved out of the artifact
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── components/          # GridMap, Panel, KpiCard, Toggle, SelectField, SliderField —
        │                        # ported from the artifact's inline-styled components
        ├── lib/
        │   ├── api.ts           # TanStack Query hooks wrapping fetches to /api/*
        │   └── format.ts        # fmtUSD, fmtKwh, etc.
        └── styles/
            └── globals.css      # Tailwind base + the IBM Plex font imports
```

## 5. Data model (Python data structures, in-memory for now)

Plain dataclasses, not an ORM yet — the ORM layer arrives in Phase 4 when
Postgres comes in, and at that point these dataclasses become the shape that
gets read out of the DB, not the source of truth.

```python
@dataclass
class TimePeriod:
    hours: list[int] | None = None
    days_of_week: list[int] | None = None   # 1=Sun..7=Sat, matches the real API's convention

@dataclass
class ChargeTier:
    cost: float
    from_: float   # kWh or kW threshold this tier starts at

@dataclass
class Charge:
    basis: str                       # "fixed" | "kwh" | "peak_kw" | "fixed_kwh" (see 05-basis-reference.md)
    range: list[ChargeTier]
    time_period: TimePeriod | None = None
    ndx: bool = False                 # index-pricing flag

@dataclass
class TariffCharges:
    customer: Charge
    energy: list[Charge]
    demand: Charge | None

@dataclass
class Tariff:
    id: str
    name: str
    blurb: str
    charges: TariffCharges

@dataclass
class Location:
    id: str
    city: str
    state: str
    iso: str            # key into ISO_PROFILES
    utility: str
    price_level: float
    map_x: float
    map_y: float
```

`ISO_PROFILES` and `BUILDING_SHAPES` stay as plain dicts (they're lookup
tables, not entities with behavior) — same shape as the artifact's JS
versions.

## 6. API design

### `/ecservice/*` — real-API-shaped core

| Method & path | Mirrors | Notes |
|---|---|---|
| `POST /ecservice/login` | real login endpoint | no-op / always-succeeds for now (see auth decision above) |
| `GET /ecservice/api/operators` | Retrieve Operators | returns our 7 ISO profiles |
| `GET /ecservice/api/distributor?zipcode=&operator_id=` | Distributor by zip | our 8 locations get fictional zip codes for this to work |
| `GET /ecservice/api/distributors?operator_id=` | Distributors by ISO | |
| `GET /ecservice/api/distributors/tariffs?id=` | Distributor Tariffs (detailed) | full charge structure, matches `02-tariff-api.md` shape |
| `POST /ecservice/calculate_custom_economy` | Calculate Custom Economy | accepts the real payload shape (`usage_by_month`, `distributor_tariff_id`, `price_node_id`, `battery_duration`, `battery_id`, etc.), returns the real response shape (`retailMonthlyCosts`, `wholesaleMonthlyCosts`, etc.) |

### `/api/*` — convenience layer for the ClarityGrid Client UI

| Method & path | Purpose |
|---|---|
| `GET /api/locations` | the 8 locations, with map coordinates and utility/ISO info |
| `GET /api/building-types` | building type keys + display labels |
| `GET /api/locations/{id}/tariffs` | tariffs at a location, simplified shape + quick annual estimate |
| `GET /api/locations/{id}/prices?year=2025` | full 8760-point hourly price array |
| `POST /api/bill` | `{location_id, building_type, monthly_kwh, tariff_id, battery?, fixed_rate?}` → full monthly + annual breakdown (retail, wholesale, and battery-adjusted if requested) — this is the one call the UI will use for its main view |
| `POST /api/compare` | two `{location_id, tariff_id}` pairs, same usage profile → both bills side by side |

## 6b. Frontend stack (Phase 2)

You said React plus fancy addons, so here's the concrete stack — flag
anything you'd rather swap:

| Piece | Choice | Why |
|---|---|---|
| Build tool | Vite | Standard for new React apps now; fast dev server, no CRA baggage |
| Language | TypeScript | The calc-engine types (Tariff, Charge, TimePeriod...) map cleanly to interfaces — worth the type safety given how easy it was to introduce silent bugs in the untyped JS version (we hit two while building it: an unmultiplied demand rate, an energy-conserving battery bug) |
| Styling | Tailwind CSS | Recreate the current design tokens (the slate/amber/teal palette, IBM Plex type scale) as a Tailwind theme instead of inline styles |
| Base components | shadcn/ui (Radix + Tailwind) | Accessible select/switch/slider primitives to replace the hand-rolled `Toggle`/`SelectField`/`SliderField` from the artifact |
| Data fetching | TanStack Query | Wraps the `/api/*` calls with caching, loading/error states — matters once the calc engine is a network call instead of an in-memory function |
| Charts | Recharts | Unchanged from the artifact |
| Icons | lucide-react | Unchanged from the artifact |
| Motion | Framer Motion | For the deliberate load-in/reveal moments described in the original design brief (KPI count-up, panel transitions) — replaces the hand-rolled `useCountUp` hook |

State management stays plain React state (`useState`) for now — the app's
state (selected location, building, tariff, which what-ifs are on) is small
enough that a dedicated state library would be premature; revisit if that
changes.

## 7. Database — now vs. later

**Now:** nothing. Everything above is generated in-process and cached in
memory. Restarting the server regenerates it deterministically from the same
seeds, so there's no data-loss concern at this stage.

**Later (Phase 4): PostgreSQL, standard, no extensions.** Two kinds of
tables, one database:

- Relational: `locations`, `distributors`, `tariffs`, `tariff_charges` — small,
  low-write, exactly what Postgres is for.
- Time-series: `price_series(location_id, ts, price)`,
  `usage_series(location_id, building_type, ts, kwh)` — bigger, append-mostly.
  At the scale this app is likely to reach (dozens of locations × a handful
  of years × hourly = low millions of rows), plain Postgres with a composite
  index on `(location_id, ts)` and monthly partitioning if it gets large is
  genuinely enough — you don't need a specialized time-series engine to get
  good performance here.

One correction to what I told you last time: I'd said Azure's managed
Postgres doesn't support the TimescaleDB extension — that's wrong, I checked
and Azure Database for PostgreSQL Flexible Server does support TimescaleDB
(Apache-2 edition). So "standard Postgres" here is a genuine choice, not one
forced by an Azure limitation — and it's the right one at this scale. Worth
revisiting only if the dataset grows by orders of magnitude (many more
locations, sub-hourly resolution, multi-year history) or you want built-in
retention/compression policies — Timescale is a config change away on the
same Azure service if that day comes, not a migration to a different one.

## 8. Azure services (prototype-sized)

Verified current as of this plan (Microsoft publishes official `azd`
templates for this exact combination — FastAPI + Postgres Flexible Server —
on both of the compute options below, which is a good sign this is a
well-trodden path, not a bespoke setup).

| Concern | Recommendation | Why |
|---|---|---|
| Compute | **Azure Container Apps** (decided) | Serverless containers, scale-to-zero (cheap when you're not actively using the prototype), simple `azd up` deploy, room to grow into multiple services (e.g. a worker later) without re-platforming. Backend ships as a Docker image. |
| Database | **Azure Database for PostgreSQL – Flexible Server**, Burstable tier (B1ms) | Managed, cheap at prototype scale, standard Postgres as decided above. |
| Container registry | Azure Container Registry | Holds the built FastAPI Docker image that Container Apps pulls from. |
| Secrets | Azure Key Vault | DB connection string and any future API keys, referenced by the container app instead of sitting in plain env vars. |
| Observability | Application Insights (via Azure Monitor OpenTelemetry) | Request tracing and logs from day one — cheap to add now, annoying to retrofit later. |
| Provisioning & CI/CD | **Azure Developer CLI (`azd`)** + GitHub Actions | `azd` is built for exactly this "prototype in a repo → deployed on Azure" flow: `azd init`, `azd up` provisions everything via Bicep and deploys the code in one command, and `azd pipeline config` wires up GitHub Actions for you. This is also a good fit for a Claude-Code-driven workflow since the infra is declarative (Bicep in `infra/`) rather than manual portal clicks. |
| Frontend hosting (Phase 2, not now) | Azure Static Web Apps | Once the UI moves out of the artifact into its own app, this is the natural pairing — static hosting + CDN, easy custom domain, separate from the API. |

**Region: East US 2.** `azd up` will prompt for this at provision time; 

**IaC provider: Bicep** (decided — Terraform was considered and set aside
for now; azd supports it as a swap-in later via `infra: provider: terraform`
in `azure.yaml`, but it'd mean hand-porting the Bicep resources to `.tf`
rather than a straight conversion, and azd's Terraform support has stayed
in beta for a while. Revisit only if a concrete reason comes up.)

**Concrete starting point** (a real, existing Microsoft/Azure-Samples `azd`
template matching this stack — FastAPI + Postgres Flexible Server +
Container Apps — closely enough to scaffold from rather than starting from
a blank repo): `azure-fastapi-postgres-addon-aca`.

## 9. Phased plan

- **Phase 1 — Backend skeleton (local only).** Port the JS engine to Python
  1:1 (data structures + calc engine + battery sim), hybrid routes, pytest
  coverage mirroring the sanity checks we already validated in the JS
  prototype (annual usage conservation, tariff totals, battery savings
  sign/magnitude across tariff types). Runs locally via `uvicorn`, no Azure
  yet.
- **Phase 2 — Connect the UI.** Move the ClarityGrid Client React component out of
  the artifact into `frontend/` (framework choice TBD, see open questions),
  replace its client-side calc calls with `fetch`s to `/api/bill` etc. Run
  both locally (two terminals or `docker-compose`).
- **Phase 3 — Deploy the prototype.** `azd init` from the template above,
  adjust the Bicep for our shape, `azd up`. Backend live on Container Apps,
  Postgres provisioned but still unused (Phase 1's in-memory data still
  backs the app).
- **Phase 4 — Real persistence.** Postgres schema, Alembic migrations,
  seed the relational tables from the current Python data structures, move
  price/usage series into the time-series tables. Calc engine logic doesn't
  change — only where the data comes from.
- **Phase 5 — later.** Real auth, more tariff basis types (the full list in
  `05-basis-reference.md` — right now only fixed/kwh/peak_kw/TOU are
  implemented), more locations, Timescale if/when volume justifies it.

## 10. Resolved decisions

- **Frontend:** React, via the stack in section 6b (Vite, TypeScript,
  Tailwind, shadcn/ui, TanStack Query, Framer Motion).
- **Dataset scope:** unchanged from the artifact — the same 8 locations, 5
  building types, and 3 tariff templates. No expansion as part of this port;
  more locations/tariffs/basis types are Phase 5.
- **Azure region:** East US.
- **Frontend hosting / CORS:** Azure Static Web Apps, default domain (no
  custom domain for the prototype). One practical wrinkle: that default
  domain (`https://<random-name>.azurestaticapps.net`) isn't known until the
  Static Web App resource is actually created — `azd up` generates it, it's
  not something we can hardcode in advance. So the backend should read its
  allowed CORS origin from an environment variable (`FRONTEND_ORIGIN`)
  rather than a hardcoded value in `config.py`, with `http://localhost:5173`
  (Vite's default) as the fallback for local dev. After the first `azd up`,
  grab the Static Web App's URL from the output and set it as the Container
  App's `FRONTEND_ORIGIN` env var (`azd env set FRONTEND_ORIGIN <url>` +
  redeploy, or wire it directly in the Bicep as an output-to-input reference
  between the two resources so it's automatic on every `azd up`).

Nothing left open — this is ready for a Claude Code session to start on
Phase 1.
