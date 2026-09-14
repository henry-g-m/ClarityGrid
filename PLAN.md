# ClarityGrid Client Backend — Plan

Status: **mostly implemented and deployed.** Phases 1–4 below are done (with
some deviations from what was originally planned — called out inline and
summarized in [§11](#11-gaps-vs-this-plan-as-of-2026-09-14)). Frontend
deployment (originally deferred past this plan's horizon) has also been
pulled forward and is now live. This document is kept as the historical
design record; where reality diverged, the divergence is noted rather than
silently rewritten.

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
2. **Data generation: pre-generate + cache.** ~~The 8 synthetic locations'
   price series are generated once at startup and cached in memory~~ **As
   built, this changed under Phase 4:** locations, tariffs, and price series
   are now seeded into Postgres once (`backend/scripts/seed_db.py`) and read
   from the DB per-request (`app/repositories.py`) rather than generated at
   startup. Usage series still depend on user-chosen `(building_type,
   monthly_kwh)`; the 5 default combinations are seeded too, and anything
   else is generated on demand and cached in-process for the life of the
   process (`app/services/cache.py`) — that part of the original decision
   held.
3. **Auth: none, for now.** This is a prototype behind your own Azure
   resources, not a multi-tenant public API. I'm designing the route
   structure so an API-key header or the real login/session-cookie mock can
   be dropped in later without reshaping anything. **Still true as built —
   no auth exists anywhere in the deployed app.**

## 3. Scope of this backend

**Reference implementation:** `ui_prototype/claritygrid-client-app.jsx` (the
former Claude.ai artifact, working title "Loadpoint" — the component inside
is `ClarityGridClientApp`; this plan originally called the file
`reference/claritygrid-client-app.jsx`, but it lives under `ui_prototype/` in
the actual repo, and — see §11 — is now also the live frontend, not just a
reference). Treat it as the source of truth for exact constants, formulas,
and behavior — the prose below describes what each piece does, but the file
has the actual seeded values and the battery/tariff math as debugged and
validated. Port from it, don't re-derive it from this description.

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

## 4. Project structure (as built)

The structure below reflects what's actually in the repo today, not the
original proposal (mainly: real DB access modules exist under `backend/app/`,
service filenames are shorter than proposed, and `frontend/` became
`ui_prototype/` with a much smaller stack than §6b describes — see §11).

```
ClarityGrid/
├── azure.yaml                  # azd project descriptor (services: backend, frontend)
├── infra/
│   ├── main.bicep              # Log Analytics, Container Apps env + app, ACR, Static Web App
│   └── main.parameters.json
├── .github/workflows/
│   └── azure-dev.yml           # test -> provision -> deploy (push to main only)
├── backend/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── app/
│   │   ├── main.py             # FastAPI() instance, CORS, router mounting, lifespan (init/close DB pool)
│   │   ├── config.py           # env vars: app name, environment, CORS origins, DATABASE_URL
│   │   ├── db.py                # psycopg_pool connection pool (init_pool/close_pool/get_pool)
│   │   ├── repositories.py      # DB reads: locations, tariffs, price_series, usage_series
│   │   ├── data/
│   │   │   ├── iso_profiles.py       # ISO_PROFILES (used at runtime by services/prices.py)
│   │   │   ├── locations.py          # LOCATIONS — seed data only now, read by scripts/seed_db.py
│   │   │   ├── building_profiles.py  # BUILDING_SHAPES (used at runtime by services/usage.py)
│   │   │   └── tariffs.py            # build_tariffs(location) -> list[Tariff] — seed data only now
│   │   ├── models/
│   │   │   ├── domain.py       # dataclasses: Location, Tariff, Charge, TimePeriod...
│   │   │   └── schemas.py      # Pydantic request/response models for the routes
│   │   ├── services/
│   │   │   ├── prices.py       # generate_hourly_prices(), the calendar (CAL), the PRNG
│   │   │   ├── usage.py        # generate_hourly_usage()
│   │   │   ├── calc_engine.py  # calculate_bill(), fixed_price_bill(), evaluate_tiered_range()
│   │   │   ├── battery.py      # simulate_battery(), find_shave_ceiling()
│   │   │   └── cache.py        # in-memory cache for on-demand (non-seeded) usage series
│   │   └── routers/
│   │       ├── real_api.py     # /ecservice/* (login, distributor, distributors/tariffs, calculate_custom_economy, operators)
│   │       └── app_api.py      # /api/* (locations, bill, compare, building-types)
│   ├── scripts/
│   │   ├── schema.sql          # locations, tariffs, price_series, usage_series tables
│   │   └── seed_db.py          # truncates + reloads all 4 tables from data/ + the generators above
│   ├── postman/
│   │   └── ClarityGrid_RealAPI.postman_collection.json  # sample requests against /ecservice/*
│   └── tests/
│       ├── test_calc_engine.py  # price/usage generation shape, bill calc shape+total>0
│       └── test_routes.py       # /api/locations, /api/bill, /ecservice/api/operators (needs live DB)
└── ui_prototype/                # the live frontend — see §11, this is NOT the §6b stack
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── write-build-env.mjs      # prebuild hook: writes VITE_API_BASE_URL from $BACKEND_URL
    ├── claritygrid-client-app.jsx  # the component itself — still the source-of-truth reference
    └── src/
        └── main.jsx
```

## 5. Data model

Plain dataclasses (`backend/app/models/domain.py`), unchanged from the
original design. The plan originally framed these as "in-memory for now,
becomes the DB read-shape in Phase 4" — Phase 4 has happened, and this is
exactly what occurred: `repositories.py` reads rows out of Postgres and
constructs these same dataclasses, so nothing downstream (calc engine,
routers) needed to change shape.

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
versions, and still read directly from `app/data/` at runtime (unlike
locations/tariffs, these were never moved into Postgres — see §11).

## 6. API design (as built — matches this section as originally written)

### `/ecservice/*` — real-API-shaped core

| Method & path | Mirrors | Notes |
|---|---|---|
| `POST /ecservice/login` | real login endpoint | no-op / always-succeeds for now (see auth decision above) |
| `GET /ecservice/api/operators` | Retrieve Operators | returns our 7 ISO profiles |
| `GET /ecservice/api/distributor?zipcode=&operator_id=` | Distributor by zip | our 8 locations get fictional zip codes for this to work |
| `GET /ecservice/api/distributors?operator_id=` | Distributors by ISO | |
| `GET /ecservice/api/distributors/tariffs?id=` | Distributor Tariffs (detailed) | full charge structure, matches `02-tariff-api.md` shape |
| `POST /ecservice/calculate_custom_economy` | Calculate Custom Economy | accepts the real payload shape (`usage_by_month`, `distributor_tariff_id`, `price_node_id`, `battery_duration`, `battery_id`, etc.), returns the real response shape (`retailMonthlyCosts`, `wholesaleMonthlyCosts`, etc.) |

A Postman collection with sample requests against all of these lives at
`backend/postman/ClarityGrid_RealAPI.postman_collection.json`.

### `/api/*` — convenience layer for the ClarityGrid Client UI

| Method & path | Purpose |
|---|---|
| `GET /api/locations` | the 8 locations, with map coordinates and utility/ISO info |
| `GET /api/building-types` | building type keys + display labels |
| `GET /api/locations/{id}/tariffs` | tariffs at a location, simplified shape + quick annual estimate |
| `GET /api/locations/{id}/prices?year=2025` | full 8760-point hourly price array |
| `POST /api/bill` | `{location_id, building_type, monthly_kwh, tariff_id, battery?, fixed_rate?}` → full monthly + annual breakdown (retail, wholesale, and battery-adjusted if requested) — this is the one call the UI uses for its main view |
| `POST /api/compare` | two `{location_id, tariff_id}` pairs, same usage profile → both bills side by side |

`battery`/`fixed_rate` on `/api/bill` were part of the original schema but
sat unused until the UI wiring work — they're now live (see
`app/routers/app_api.py`), applying `services/battery.simulate_battery` and
`services/calc_engine.fixed_price_bill` before computing the returned bill.
`/api/compare` does **not** apply battery/fixed-rate adjustments on either
side — that was true of the original artifact's comparison too, not a
regression.

`app/services/calc_engine.py` now also implements four more bases from
`05-basis-reference.md` beyond fixed/kwh/peak_kw/TOU: **index pricing**
(`ndx: true` on an energy charge — the hourly wholesale price is used
directly instead of a fixed $/kWh rate), **feed-in credit** (`feedin_rate`
on an energy charge — negative/exported usage is credited at that rate
instead of billed at the normal tier), **`daily_kwh_tr`** (energy tiers
reset each day instead of accumulating over the month), and
**`daily_peak_kw`/`daily_peak_kw_tr`** (demand charge is the sum of each
day's peak × rate, instead of one charge against the month's single peak).
None of the 8 seeded locations' 3 tariff templates use these yet (dataset
scope is still frozen, per §10) — they're engine capability, covered by
`backend/tests/test_tariff_basis.py`, exercised with ad-hoc `Tariff`/`Charge`
objects rather than seed data. Ratchets, coincident peak, and block-factor
tiering remain unimplemented — see §11.

## 6b. Frontend stack (Phase 2) — **planned, not what was built**

You said React plus fancy addons, so here's the concrete stack that was
planned — see [§11](#11-gaps-vs-this-plan-as-of-2026-09-14) for what
actually shipped instead (a much smaller Vite+JS scaffold directly around
the existing artifact component, deliberately, to keep the port a thin
wiring change rather than a rewrite):

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

**As built (this happened — Phase 4 is done):** PostgreSQL, standard, no
extensions, matching the plan below almost exactly:

- Relational: `locations`, `tariffs` (charges stored as JSONB, decoded via
  `repositories._charge_from_json`) — small, low-write.
- Time-series: `price_series(location_id, ts, price)`,
  `usage_series(location_id, building_type, ts, kwh)` — seeded for the 5
  default building types at the default monthly kWh; anything else (a
  different `monthly_kwh` the user picks) is generated on demand by
  `services/usage.py` and cached in-process, not written back to the DB.
- `backend/scripts/schema.sql` defines the tables; `backend/scripts/seed_db.py`
  truncates and reloads all of them from `app/data/` + the price/usage
  generators, so the DB and the in-process calc engine can never drift.

**What did not happen, and is a real gap:** no migration tool (Alembic or
otherwise) — see §11. Schema changes today mean hand-editing `schema.sql`
and re-running `seed_db.py`, which is destructive (truncates everything).
That's fine for a prototype seeded from deterministic generators, but would
not survive real user-entered data.

One correction from the original plan text: Azure's managed Postgres *does*
support the TimescaleDB extension (Azure Database for PostgreSQL Flexible
Server supports the Apache-2 edition) — standard Postgres here is a genuine
choice, not an Azure limitation, and remains the right one at this scale.

## 8. Azure services (as built)

| Concern | Planned | As built | Notes |
|---|---|---|---|
| Compute | Azure Container Apps | ✅ done | `infra/main.bicep`: `backendApp`, scale-to-zero (0–2 replicas) |
| Frontend hosting | Azure Static Web Apps (Phase 2, "not now") | ✅ done, pulled forward | `staticWebApp` resource, Free tier, deployed via `azd`'s `staticwebapp` host support |
| Database | Azure Database for PostgreSQL Flexible Server, Burstable (B1ms) | ⚠️ done, but **not in this IaC** | The Postgres server (`claritygrid-pg-dev`) lives in the same resource group (`rg-claritygrid-dev`) but was provisioned outside `infra/main.bicep` — `databaseUrl` is passed in as a secure param/GitHub secret, not created by this template. See §11. |
| Container registry | Azure Container Registry | ✅ done | `containerRegistry`, Basic SKU |
| Secrets | Azure Key Vault | ❌ not built | `DATABASE_URL` is a plain Container Apps secret (`secrets: [{name: 'database-url', ...}]`), not Key Vault-backed. Works, but not what was planned. See §11. |
| Observability | Application Insights (Azure Monitor OpenTelemetry) | ❌ not built | Only a Log Analytics workspace exists, wired to the Container Apps environment for container stdout/stderr logs — no App Insights resource, no request tracing/OpenTelemetry. See §11. |
| Provisioning & CI/CD | Azure Developer CLI (`azd`) + GitHub Actions | ✅ done | `.github/workflows/azure-dev.yml`: test (pytest + frontend build) → provision → deploy (manually-approved `dev` environment gate), on push to `main` |

**Region: East US 2** (this plan previously contradicted itself — §8 said
East US 2, §10 said East US; the live environment's `AZURE_LOCATION` is
`eastus2`, which is also one of the small set of regions that support
Static Web Apps, so East US 2 is confirmed correct).

**IaC provider: Bicep** (decided — unchanged).

## 9. Phased plan — status

- **Phase 1 — Backend skeleton (local only).** ✅ Done. Calc engine + battery
  sim ported 1:1, hybrid routes, `uv run pytest` passes locally and in CI.
- **Phase 2 — Connect the UI.** ✅ Done, differently than planned: the
  artifact component moved to `ui_prototype/` (not `frontend/`) with a
  minimal Vite+JS scaffold — not the TypeScript/Tailwind/shadcn/TanStack
  Query/Framer Motion stack in §6b. Its client-side calc/generation code was
  removed entirely in favor of `fetch`s to `/api/*`. See §11 for why and
  what that leaves on the table.
- **Phase 3 — Deploy the prototype.** ✅ Done, and expanded: backend is live
  on Container Apps, *and* the frontend is live on Static Web Apps (originally
  slated for later). Postgres is live too, but — unlike this phase's original
  assumption of "unused in-memory data" — it's actively serving every
  request, and it isn't part of this template's provisioning (see §8, §11).
- **Phase 4 — Real persistence.** ✅ Done, differently than planned: schema +
  seed script exist and are live, but there's no Alembic (or any) migration
  tooling — `seed_db.py` is a truncate-and-reload script, not a migration
  chain. Calc engine logic didn't change, as planned — only where the data
  comes from.
- **Phase 5 — later.** Partly started: fixed/kwh/peak_kw/TOU plus index
  pricing, feed-in credit, and daily-tiered energy/demand bases are now
  implemented (see §6, `test_tariff_basis.py`) — none of it wired into the
  seeded dataset yet. Still open: real auth, ratchets/coincident-peak/
  block-factor bases, more locations, Timescale if/when volume justifies it.

## 10. Resolved decisions

- **Frontend:** ~~React, via the stack in section 6b~~ **As built:** React,
  via Vite + plain JS + inline styles + hand-rolled components + manual
  `fetch`/`useEffect` — see §11 for the reasoning and what's missing versus
  §6b.
- **Dataset scope:** unchanged from the artifact — the same 8 locations, 5
  building types, and 3 tariff templates. No expansion has happened;
  more locations/tariffs/basis types are still Phase 5.
- **Azure region:** East US 2 (fixed contradiction with §8 — see above).
- **Frontend hosting / CORS:** Azure Static Web Apps, default domain (no
  custom domain). ✅ Implemented exactly as speculated here: the backend's
  Container App reads its CORS allowlist from `CLARITYGRID_CORS_ORIGINS`,
  wired in Bicep as an output-to-input reference to the Static Web App's own
  `defaultHostname` — automatic on every `azd provision`, no manual step.

## 11. Gaps vs. this plan (as of 2026-09-14)

Concrete, actionable items — roughly in order of how much they'd matter if
this stopped being a prototype:

1. **No database migrations.** `backend/scripts/seed_db.py` truncates and
   reloads every table; there's no Alembic (or other) migration chain. Fine
   today because all data is deterministically regenerated from `app/data/`,
   but any hand-entered/user-generated data in Postgres would not survive a
   schema change. Worth adding before this holds anything not reproducible
   from the generators.
2. **Postgres isn't in the IaC.** `infra/main.bicep` takes `databaseUrl` as
   an opaque secure param; the actual Flexible Server (`claritygrid-pg-dev`)
   was created by hand and lives in `rg-claritygrid-dev` alongside (but
   outside) what `azd provision` manages. A fresh `azd up` in a new
   environment would provision compute with no database to point it at.
3. **No Key Vault.** `DATABASE_URL` is a Container Apps-native secret, not
   Key Vault-backed. Acceptable at this scale/threat model, but a deviation
   from §8's plan, and there's no path yet for a rotated/managed-identity-based
   DB credential.
4. **No observability beyond container logs.** Only a Log Analytics
   workspace for stdout/stderr exists — no Application Insights, no request
   tracing, no OpenTelemetry. Debugging a production issue today means
   reading raw container logs.
5. **Frontend stack is far smaller than §6b planned.** No TypeScript, no
   Tailwind (still inline styles), no shadcn/ui, no TanStack Query (plain
   `useState`/`useEffect` + a hand-rolled `api()` fetch helper), no Framer
   Motion. This was a deliberate scope call when connecting the UI (minimize
   the diff from the working artifact rather than rewrite it), not an
   oversight — but it means the "silent bugs from untyped JS" risk §6b called
   out is still live, and the design-system work (Tailwind tokens, shadcn
   primitives) hasn't happened.
6. ~~No battery test coverage.~~ **Closed 2026-09-14.**
   `backend/tests/test_battery.py` now covers: `find_shave_ceiling` respects
   its capacity budget, the battery never increases a day's peak usage,
   round-trip losses mean total annual usage with the battery is never lower
   than without it, a flat tariff sees no benefit (and can't, structurally),
   a demand tariff's demand charges go down, and the battery reduces
   usage-weighted wholesale cost.
7. **No auth**, as planned/accepted — listed here only so it's not mistaken
   for an oversight. Fine for a prototype; would need real auth before any
   real multi-tenant or public exposure.
8. **8 of the real API's tariff basis types are now implemented** — the
   original 4 (fixed/kwh/peak_kw/TOU) plus, as of 2026-09-14, index pricing
   (`ndx`), feed-in credit (`feedin_rate`), and the two daily-reset bases
   (`daily_kwh_tr`, `daily_peak_kw`/`daily_peak_kw_tr`) — see §6 and
   `test_tariff_basis.py`. Deliberately still unimplemented: block-factor
   tiering (`peak_kw_bf`, `billdmd_bf`, ...), ratchets
   (`*_ratchet`), and coincident peak (`x_coincident_peak`, `dced`) — these
   need either real ISO coincident-peak-hour data (which doesn't exist in
   this synthetic dataset) or a firm decision on trailing-month semantics at
   a single-year dataset's boundary, neither of which this session had
   enough information to decide unilaterally.
9. **CI/CD had a resource-group targeting bug**, now fixed: the workflow
   never forwarded the `AZURE_RESOURCE_GROUP` repo variable to `azd`, so it
   silently provisioned a second, duplicate resource group (`rg-dev`)
   instead of the intended `rg-claritygrid-dev`. Fixed in
   `.github/workflows/azure-dev.yml`; the stray `rg-dev` has been deleted.
   Flagged here as a reminder that this class of drift (local `.azure/`
   state vs. CI having no persisted state between jobs) is easy to
   reintroduce if new azd outputs are added without threading them through
   both the `provision` and `deploy` jobs.
