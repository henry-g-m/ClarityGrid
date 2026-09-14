# Backend Observability: Logging, Tracing & Metrics

**Status:** Implemented, one open issue (see "Known issues" below)
**Date:** 2026-09-13
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
- **Live Metrics**: currently disabled (`enable_live_metrics=False`) — see
  "Known issues".
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
- **Performance counters**: Azure Monitor's distro also emits process-level
  counters (CPU, memory) by default whenever a connection string is set.
- **Not instrumented**: the `/ecservice/*` mirror endpoints in
  `routers/real_api.py` have no custom business metrics — only the generic
  HTTP-request metric above.

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

1. **`AppRequests` was empty despite confirmed live traffic** (found
   2026-09-13, right after first deploying this). `AppTraces`,
   `AppDependencies`, and `AppMetrics` all confirmed flowing correctly;
   only the incoming-request spans weren't landing. Root cause wasn't
   pinned down with certainty (couldn't get container shell access to
   inspect live state), but Live Metrics / dynamic configuration was the
   one part of the trace pipeline not shared with the working
   logs/metrics pipelines. [PR #5](https://github.com/henry-g-m/ClarityGrid/pull/5)
   disables it, pins the sampler, and adds a startup log line
   (`Telemetry configured: fastapi_instrumented=... span_processors=...`)
   to confirm instrumentation state directly from container logs on the
   next deploy. **Verify after merging**: check for that log line, then
   re-run the `AppRequests | count` query above.
2. **`AppTraces` noise**: exporting the root logger means Azure SDK's own
   internal HTTP client logging (`azure.core.pipeline.policies.http_logging_policy`)
   gets shipped to Application Insights alongside real application logs.
   Worth raising that specific logger's level (e.g. `WARNING`) once the
   above is resolved, so it doesn't drown out real `app.request` lines.
3. **Unrelated, found during this investigation**: intermittent
   `error connecting in 'pool-1': connection timeout expired` from the
   psycopg connection pool (`app/db.py`), causing occasional 500s on
   `/api/bill` and `/api/locations` under load. Not caused by the
   observability work — flagged here because it surfaced while reading
   the same container logs.
