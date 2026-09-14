# Backend Observability: Logging, Tracing & Metrics

**Status:** Implemented and verified end-to-end (see "Known issues" for one remaining cleanup item)
**Date:** 2026-09-13, updated 2026-09-14
**Scope:** `backend/` only — the frontend has no observability instrumentation.

This is an internal reference doc for this project's own backend service,
not part of the crawled Clarity Grid API documentation set (`01-08` in this
folder) — see `ADR-0001-backend-architecture.md` for the same distinction.

## Why

The backend runs on Azure Container Apps, which already provisions a Log
Analytics workspace for container console logs (`infra/main.bicep`). This
work adds application-level logging, distributed tracing, and metrics on
top of that, using OpenTelemetry via the Azure Monitor distro, so all three
land in one place (Application Insights) without standing up separate
infrastructure (Prometheus/Grafana/Tempo) that this project doesn't
otherwise need.

## How it's wired

All of it lives in `backend/app/observability.py`, called from
`backend/app/main.py`:

```python
configure_logging()          # module-level, before the app is created
...
app = FastAPI(...)
configure_telemetry(app)     # instruments FastAPI + psycopg, configures Azure Monitor
...
add_request_logging_middleware(app)
```

Config is two environment variables (`backend/app/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | unset | When set, traces/logs/metrics export to Application Insights. When unset, the app still runs (local dev) but nothing is exported anywhere. |
| `LOG_LEVEL` | `INFO` | Root logger level. |

In Azure, the connection string comes from a **workspace-based Application
Insights** resource (`appi-claritygrid-<env>`) that `infra/main.bicep`
provisions on top of the *same* Log Analytics workspace the Container Apps
environment already uses for console logs, wired to the backend container
app as a secret-backed env var (`appinsights-connection-string`). No manual
secret-setting is needed — `azd provision`/`azd up` creates and wires it
automatically.

## Logging

- **Per-request access log**: `add_request_logging_middleware` logs one
  `INFO` line per HTTP call, under logger `app.request`:
  `METHOD path -> status (duration_ms)`.
- **Everything else**: standard `logging` module, console output, format is
  `timestamp LEVEL [trace_id=... span_id=...] logger: message` — the
  trace/span id are stamped by `_TraceContextFilter` from whatever span is
  active when the log line is emitted, so a log line can be pivoted to its
  trace and back.
- **Export**: when a connection string is configured, `configure_azure_monitor()`
  attaches an OpenTelemetry `LoggingHandler` to the **root** logger. This
  means *every* logger in the process gets exported to Application
  Insights' `AppTraces` table — not just `app.request`, but anything any
  installed library logs (uvicorn, psycopg pool warnings, Azure SDK's own
  internal HTTP client logging). See "Known issues" — this currently makes
  `AppTraces` noisier than intended.

## Tracing

- **Incoming HTTP requests**: `opentelemetry-instrumentation-fastapi`
  auto-instruments the FastAPI app (`FastAPIInstrumentor.instrument_app(app)`),
  creating one `SERVER` span per request with standard HTTP attributes
  (method, route, status code, target, duration).
- **Database calls**: `opentelemetry-instrumentation-psycopg` auto-instruments
  the psycopg v3 driver, creating one `CLIENT` span per DB query.
- **Sampling**: pinned to 100% (`sampling_ratio=1.0`), passed explicitly to
  `configure_azure_monitor()`.
- **Live Metrics**: disabled (`enable_live_metrics=False`). This is the
  fix for the `AppRequests` issue below (`sampling_ratio=1.0` was already
  the default, so disabling Live Metrics is what actually changed
  behavior) — it's off deliberately, not a leftover debugging step.
  Re-enabling it would need to be re-verified against `AppRequests`
  before shipping.
- **Local dev** (no connection string): spans are still created with real,
  valid trace/span ids (so the logging correlation above still works), but
  there's no processor/exporter attached, so nothing is sent anywhere.

## Metrics

- **HTTP server metrics**: emitted automatically by the FastAPI
  instrumentation (request duration/count/in-flight, broken down by
  route/method/status) — standard OTel semantic-convention metrics.
- **Custom metric** — `claritygrid.bill_calculations`: a counter, tagged by
  `tariff_id`, incremented once per bill calculation. It lives in
  `app/services/calc_engine.py::calculate_bill()`, the single choke point
  shared by `POST /api/bill`, `POST /api/compare`, and
  `GET /api/locations/{id}/tariffs` — all three surface it without their
  own instrumentation.
- **Custom metric** — `claritygrid.ecservice_calculations`: a counter,
  tagged by `distributor_tariff_id`, incremented once per
  `POST /ecservice/calculate_custom_economy` call. Lives directly in
  `app/routers/real_api.py` (that endpoint is the only `/ecservice/*` route
  with real request-body-derived business meaning — the others are static
  or DB-lookup reads already covered by the generic HTTP-request metric).
- **Performance counters**: Azure Monitor's distro also emits process-level
  counters (CPU, memory) by default whenever a connection string is set.
- **Read-only `/ecservice/*` routes** (`login`, `operators`, `distributor`,
  `distributors`, `distributors/tariffs`): no custom business metric, same
  as their `/api/*` read-route counterparts — only the generic
  HTTP-request metric (and, for the DB-backed ones, the `psycopg`
  dependency spans) above.

## Querying the data

Workspace-based Application Insights stores everything in the Log
Analytics workspace (`log-claritygrid-<env>`), queryable with the standard
App* tables:

```kql
union AppRequests, AppDependencies, AppTraces, AppMetrics
| where TimeGenerated > ago(1h)
| summarize count() by Type
```

```kql
AppRequests
| where TimeGenerated > ago(1h)
| project TimeGenerated, Name, Url, ResultCode, DurationMs, Success
| order by TimeGenerated desc
```

Via CLI:
```sh
az monitor log-analytics query -w <workspace-customer-id> \
  --timespan P1D \
  --analytics-query "AppRequests | count"
```
(get `<workspace-customer-id>` via
`az monitor log-analytics workspace show -g <rg> -n log-claritygrid-<env> --query customerId -o tsv`)

## Known issues

1. ~~**`AppRequests` was empty despite confirmed live traffic**~~ —
   **Resolved and verified 2026-09-14.** `AppTraces`, `AppDependencies`,
   and `AppMetrics` were flowing correctly the whole time; only the
   incoming-request spans weren't landing. [PR #5](https://github.com/henry-g-m/ClarityGrid/pull/5)
   (merged) disabled Live Metrics and pinned the sampler. After it
   deployed:
   - The new startup log line confirmed instrumentation was wired
     correctly: `Telemetry configured: fastapi_instrumented=True
     tracer_provider=TracerProvider span_processors=3`.
   - A marker request (`GET /health?probe=verify-apprequests-fix`) sent
     straight to the deployed backend showed up in `AppRequests` within
     seconds, with matching URL, status code, and duration — confirming
     Live Metrics was the actual cause, not a sampling or logging
     interaction. All four telemetry types (`AppRequests`,
     `AppDependencies`, `AppTraces`, `AppMetrics`) are now confirmed
     flowing end-to-end.
   - Root cause is scoped to "disabling Live Metrics fixes it" rather
     than "here's the exact line in the Azure Monitor distro that was
     dropping SERVER spans" — that deeper why wasn't pinned down (no
     container shell access to inspect live state), so treat Live
     Metrics as the known trigger, not a fully explained mechanism.
2. **`AppTraces` noise** (still open): exporting the root logger means
   Azure SDK's own internal HTTP client logging
   (`azure.core.pipeline.policies.http_logging_policy`) gets shipped to
   Application Insights alongside real application logs. Worth raising
   that specific logger's level (e.g. `WARNING`) so it doesn't drown out
   real `app.request` lines.
3. **Unrelated, found during this investigation** (still open):
   intermittent `error connecting in 'pool-1': connection timeout
   expired` from the psycopg connection pool (`app/db.py`), causing
   occasional 500s on `/api/bill` and `/api/locations` under load. Not
   caused by the observability work — flagged here because it surfaced
   while reading the same container logs. See
   [`OPS-0002-stress-testing.md`](OPS-0002-stress-testing.md) for the plan
   to reproduce this deliberately instead of waiting for it in production.
