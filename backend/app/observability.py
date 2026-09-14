from __future__ import annotations

import logging
import time
from typing import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from opentelemetry import metrics, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider

from app.config import settings

logger = logging.getLogger("app.request")

_METER_NAME = "claritygrid.backend"


class _TraceContextFilter(logging.Filter):
    """Stamps every log record with the active trace/span id, so log lines can be
    correlated with the spans exported for the same request."""

    def filter(self, record: logging.LogRecord) -> bool:
        span_context = trace.get_current_span().get_span_context()
        if span_context.is_valid:
            record.trace_id = format(span_context.trace_id, "032x")
            record.span_id = format(span_context.span_id, "016x")
        else:
            record.trace_id = "-"
            record.span_id = "-"
        return True


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.addFilter(_TraceContextFilter())
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)s [trace_id=%(trace_id)s span_id=%(span_id)s] %(name)s: %(message)s"
        )
    )
    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())
    root.handlers = [handler]


def configure_telemetry(app: FastAPI) -> None:
    resource = Resource.create({"service.name": settings.app_name, "service.namespace": "claritygrid"})

    if settings.applicationinsights_connection_string:
        from azure.monitor.opentelemetry import configure_azure_monitor

        configure_azure_monitor(
            connection_string=settings.applicationinsights_connection_string,
            resource=resource,
            sampling_ratio=1.0,
            enable_live_metrics=False,
        )
    else:
        logger.warning(
            "APPLICATIONINSIGHTS_CONNECTION_STRING is not set; spans and metrics are recorded "
            "(logs will show real trace/span ids) but nothing is exported."
        )
        trace.set_tracer_provider(TracerProvider(resource=resource))
        metrics.set_meter_provider(MeterProvider(resource=resource))

    FastAPIInstrumentor.instrument_app(app)
    PsycopgInstrumentor().instrument()

    provider = trace.get_tracer_provider()
    processors = getattr(getattr(provider, "_active_span_processor", None), "_span_processors", ())
    logger.info(
        "Telemetry configured: fastapi_instrumented=%s tracer_provider=%s span_processors=%d",
        getattr(app, "_is_instrumented_by_opentelemetry", False),
        type(provider).__name__,
        len(processors),
    )


def get_meter() -> metrics.Meter:
    return metrics.get_meter(_METER_NAME)


def add_request_logging_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def log_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "%s %s -> %d (%.1fms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
        )
        return response
