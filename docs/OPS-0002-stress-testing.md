# Backend Stress Testing: Plan & Design

**Status:** Planned — design only, nothing built yet.
**Date:** 2026-09-13
**Scope:** `backend/` HTTP APIs — both `/api/*` (the UI convenience layer,
`app/routers/app_api.py`) and `/ecservice/*` (the real-API-shaped mirror,
`app/routers/real_api.py`). No frontend load testing.

This is a companion doc to [`OPS-0001-observability.md`](OPS-0001-observability.md):
that doc is what we'll watch (traces/logs/metrics) while these tests run.

## Why

Two concrete motivations, not testing for its own sake:

1. **Known issue #3 in `OPS-0001`** — intermittent `error connecting in
   'pool-1': connection timeout expired` from the psycopg pool under load,
   causing occasional 500s on `/api/bill` and `/api/locations`. We have a
   symptom report from production-like traffic but no repeatable way to
   reproduce it locally or confirm a fix.
2. **No load has ever been characterized.** We don't know this service's
   breaking point, so we can't set alert thresholds, size the Container App,
   or size the DB connection pool with anything but guesses. The
   `claritygrid.bill_calculations` and (new) `claritygrid.ecservice_calculations`
   counters give us a way to cross-check that the metrics pipeline itself
   doesn't drop data under load, which matters given `OPS-0001`'s history of
   a telemetry gap (`AppRequests`) that looked like a load problem but wasn't.

## Specific risk areas found by reading the code

These aren't guesses — each is a concrete thing in the current code that a
generic "hit it with traffic" test would either miss or only surface by
accident. The test design below is built to target each one directly.

| # | Where | Risk |
|---|---|---|
| 1 | `app/db.py` — `ConnectionPool(..., min_size=1, max_size=5)` | Hard cap of 5 concurrent DB connections. Any endpoint that touches the DB (`repositories.*`, so most of `/api/*` and the `distributor`/`distributors`/`distributors/tariffs` routes in `/ecservice/*`) will start queuing, then timing out, once concurrent in-flight requests exceed 5. This is almost certainly known issue #3's mechanism — untested. |
| 2 | `app/services/cache.py` — `_USAGE_CACHE` | Unbounded, process-lifetime, in-memory dict keyed by `(location_id, building_type, monthly_kwh)`. A load generator that varies `monthly_kwh` per virtual user (which is realistic — the UI lets users type any value) will grow this dict without eviction. Worth measuring memory growth, not just latency. |
| 3 | `app/routers/app_api.py::calculate_bill_endpoint` / `calc_engine.calculate_bill` | `calculate_bill` is a plain synchronous function (loops over 8760 hourly points) called directly inside an `async def` route handler — not offloaded via `run_in_threadpool` or similar. Under Python's GIL this is CPU-bound work running on the single event-loop thread, so concurrent `/api/bill` calls may serialize and stall unrelated requests (even `/health`) rather than run in parallel. This is a specific, testable hypothesis: throughput should plateau (or latency should spike uniformly across *all* routes, not just `/api/bill`) well before the DB pool limit is reached. |
| 4 | `/ecservice/calculate_custom_economy` | The only `/ecservice/*` route with a request-body-driven business metric (`claritygrid.ecservice_calculations`, just added). It does no DB or cache work at all — pure CPU-light arithmetic — so it's a useful *control*: if this route's latency degrades under the same load that degrades `/api/bill`, that points at shared bottlenecks (event loop, container CPU) rather than DB/cache-specific ones. |

## Tool choice

**Locust**, not k6 or JMeter.

- The whole project is Python/`uv`-based; Locust test files are plain Python,
  so they can import `app.models.schemas` request shapes directly instead of
  hand-duplicating JSON payloads in a separate DSL.
- Supports weighted `TaskSet`/`User` classes, which maps directly to "realistic
  mixed traffic" (see scenarios below), plus a headless CLI mode that's
  scriptable in CI.
- Trade-off acknowledged: k6 has better default reporting (built-in
  percentile breakdowns, thresholds-as-code) and lower per-VU overhead if we
  ever need very high concurrency from a single machine. If a later run needs
  >~500 concurrent simulated users from one box, revisit.

Proposed home: `backend/loadtest/`, added as its own `uv` dependency group
(`loadtest`, not `dev`) so `locust` isn't pulled into the normal dev/test
install.

## Test scenarios (proposed `User` classes)

1. **`ReadHeavyUser`** (highest weight — simulates map/browse traffic):
   `GET /api/locations`, `GET /api/locations/{id}/tariffs`,
   `GET /api/locations/{id}/prices`, `GET /ecservice/api/operators`,
   `GET /ecservice/api/distributors`. All either DB reads or static data —
   exercises risk #1 without #2 or #3.
2. **`BillCalculationUser`**: `POST /api/bill` and `POST /api/compare` with
   randomized `location_id`, `building_type`, and — deliberately — a
   `monthly_kwh` drawn from a wide random range (not the seeded default) to
   force cache misses and grow `_USAGE_CACHE` (risk #2), plus occasional
   `battery` params to exercise `simulate_battery`. Targets risks #1–#3.
3. **`EcserviceCalculationUser`**: `POST /ecservice/calculate_custom_economy`
   with varied `distributor_tariff_id`/`usage_by_month`. This is the control
   for risk #3 — it should stay fast even when `BillCalculationUser` traffic
   is degrading `/api/bill`, if the event-loop-blocking hypothesis is wrong;
   if it also degrades in lockstep, that confirms shared-resource
   contention (CPU/event loop) rather than a DB- or cache-specific cause.
4. **`MixedRealisticUser`**: weighted combination of the three above
   (proposed weights: 70% read, 25% bill calc, 5% ecservice) as the
   "normal day" baseline before ramping into the targeted scenarios above.

Ramp plan for each scenario: fixed request-rate steps rather than one long
ramp, so we can name the concurrency level where things break: 5, 10, 20, 50,
100 concurrent users, ~2 minutes per step (matches the DB pool's `max_size=5`
so step 1 should be the boundary for risk #1).

## Where to run it

- **Local first, always.** `uv run uvicorn` + a local/dev Postgres (or the
  same dev DB `backend/.env` already points at) has zero blast radius beyond
  that DB. This is where we validate the four hypotheses above.
- **Azure (deployed Container App), only with explicit go-ahead.** It's a
  shared resource with a real (if small) Postgres and real cost — do not
  point sustained load at it without asking first. If we do, prefer scaling
  a copy of the environment (`azd env new loadtest`) over the `dev`/prod-like
  one, so a self-inflicted outage doesn't affect anyone else looking at the
  deployed URL.

## What to watch while it runs (ties back to `OPS-0001`)

- `AppRequests` — latency (p50/p95/p99) and error rate, sliced by `Name`
  (route), to see exactly which routes degrade first.
- `AppDependencies` — psycopg span duration and failure rate; pool
  exhaustion should show up here as slow or failed DB spans before it shows
  up as a 500 at the HTTP layer.
- `claritygrid.bill_calculations` / `claritygrid.ecservice_calculations` —
  cross-check the counted rate against Locust's own request-rate output, as
  a sanity check that the metrics pipeline doesn't silently drop data under
  load (directly relevant after `OPS-0001`'s `AppRequests` gap).
- Container App CPU% — if CPU pins near 100% while p95 latency degrades
  *uniformly* across all routes (including the ecservice control), that
  supports the event-loop-blocking hypothesis (risk #3) over a DB-specific
  one.
- Container memory over the run's duration, specifically during
  `BillCalculationUser` steps — confirms or refutes the unbounded-cache
  concern (risk #2).

## Proposed acceptance thresholds (draft — need sign-off, none exist today)

No SLOs exist for this service yet, so these are starting proposals to
validate or revise against the first test run's actual numbers, not
pre-agreed targets:

- Read routes (`ReadHeavyUser`): p95 < 300ms at 20 concurrent users.
- `/api/bill` / `/api/compare`: p95 < 1500ms at 20 concurrent users.
- `/ecservice/calculate_custom_economy`: p95 < 200ms at 20 concurrent users
  (control route — should stay cheap regardless of what else is happening).
- Error rate < 1% at the concurrency level matching `max_size=5` on the DB
  pool (i.e., we expect *some* queuing above 5 concurrent DB-touching
  requests, but it should show up as added latency, not failed requests).

## Next steps (not yet started)

1. Add `loadtest` dependency group to `backend/pyproject.toml` (`locust`).
2. Write `backend/loadtest/locustfile.py` implementing the four `User`
   classes above.
3. Run the ramp plan locally, record actual p50/p95/error-rate numbers per
   step, and use them to either confirm this doc's draft thresholds or
   replace them with measured ones.
4. Reproduce (or rule out) known issue #3 specifically, and — if confirmed
   — decide a fix (raise `max_size`, add pool-wait timeout handling/backoff,
   or both) as a follow-up change, not part of this doc.
5. Only after local results look sane, consider a single confirmed-in-advance
   run against a disposable Azure environment.
