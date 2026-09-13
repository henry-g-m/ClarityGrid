"""In-memory cache for on-demand usage series (non-seeded monthly_kwh values).

Locations, tariffs, seeded price/usage series now live in Postgres --
see app.repositories. This cache only covers the user-chosen (building_type,
monthly_kwh) combinations that fall outside what's seeded in the DB, since
those are generated on the fly and there's no reason to recompute per
request for the life of the process.
"""

from __future__ import annotations

from app.services.usage import generate_hourly_usage

_USAGE_CACHE: dict[tuple[str, str, float], list[float]] = {}


def get_or_generate_usage(location_id: str, building_type: str, monthly_kwh: float) -> list[float]:
    key = (location_id, building_type, monthly_kwh)
    cached = _USAGE_CACHE.get(key)
    if cached is None:
        cached = generate_hourly_usage(building_type, monthly_kwh, location_id)
        _USAGE_CACHE[key] = cached
    return cached
