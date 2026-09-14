from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import close_pool, init_pool
from app.observability import add_request_logging_middleware, configure_logging, configure_telemetry
from app.routers.app_api import router as app_api_router
from app.routers.real_api import router as real_api_router

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()
    yield
    close_pool()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

configure_telemetry(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

add_request_logging_middleware(app)


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(app_api_router)
app.include_router(real_api_router)
