"""DB-backed reads for locations, tariffs, and the seeded price/usage series.

Mirrors the shape app.services.cache used to serve from in-memory data --
same Location/Tariff dataclasses out, just sourced from Postgres now.
"""

from __future__ import annotations

from app.db import get_pool
from app.models.domain import Charge, ChargeTier, Location, Tariff, TariffCharges, TimePeriod

DEFAULT_MONTHLY_KWH = 3000.0
SEEDED_BUILDING_TYPES = {"SmallOffice", "Retail", "SmallHotel", "Warehouse", "MidriseApartment"}

_LOCATION_COLUMNS = "id, city, state, iso, utility, price_level, map_x, map_y"


def _row_to_location(row) -> Location:
    id_, city, state, iso, utility, price_level, map_x, map_y = row
    return Location(
        id=id_, city=city, state=state, iso=iso, utility=utility,
        price_level=price_level, map_x=map_x, map_y=map_y,
    )


def list_locations() -> list[Location]:
    with get_pool().connection() as conn:
        rows = conn.execute(
            f"SELECT {_LOCATION_COLUMNS} FROM locations ORDER BY ordinal"
        ).fetchall()
    return [_row_to_location(row) for row in rows]


def get_location(location_id: str) -> Location | None:
    with get_pool().connection() as conn:
        row = conn.execute(
            f"SELECT {_LOCATION_COLUMNS} FROM locations WHERE id = %s",
            (location_id,),
        ).fetchone()
    return _row_to_location(row) if row else None


def _charge_from_json(data: dict | None) -> Charge | None:
    if data is None:
        return None
    tp = data.get("time_period")
    return Charge(
        basis=data.get("basis", "kwh"),
        range=[ChargeTier(cost=tier["cost"], from_=tier["from"]) for tier in data["range"]],
        time_period=None if tp is None else TimePeriod(hours=tp.get("hours"), days_of_week=tp.get("days_of_week")),
        ndx=data.get("ndx", False),
        feedin_rate=data.get("feedin_rate", 0.0),
    )


def _row_to_tariff(row) -> Tariff:
    tariff_id, name, blurb, charges = row
    return Tariff(
        id=tariff_id,
        name=name,
        blurb=blurb,
        charges=TariffCharges(
            customer=_charge_from_json(charges["customer"]),
            energy=[_charge_from_json(c) for c in charges["energy"]],
            demand=_charge_from_json(charges.get("demand")),
        ),
    )


def list_tariffs(location_id: str) -> list[Tariff]:
    with get_pool().connection() as conn:
        rows = conn.execute(
            "SELECT id, name, blurb, charges FROM tariffs WHERE location_id = %s ORDER BY id",
            (location_id,),
        ).fetchall()
    return [_row_to_tariff(row) for row in rows]


def get_tariff(location_id: str, tariff_id: str) -> Tariff | None:
    with get_pool().connection() as conn:
        row = conn.execute(
            "SELECT id, name, blurb, charges FROM tariffs WHERE location_id = %s AND id = %s",
            (location_id, tariff_id),
        ).fetchone()
    return _row_to_tariff(row) if row else None


def get_price_series(location_id: str) -> list[float]:
    with get_pool().connection() as conn:
        rows = conn.execute(
            "SELECT price FROM price_series WHERE location_id = %s ORDER BY ts",
            (location_id,),
        ).fetchall()
    return [row[0] for row in rows]


def get_seeded_usage_series(location_id: str, building_type: str) -> list[float] | None:
    """Usage at the seeded DEFAULT_MONTHLY_KWH snapshot, or None if not seeded
    for this (location, building_type) pair -- caller falls back to generating
    it on demand (see app.services.usage) for non-default monthly_kwh."""
    with get_pool().connection() as conn:
        rows = conn.execute(
            "SELECT kwh FROM usage_series WHERE location_id = %s AND building_type = %s ORDER BY ts",
            (location_id, building_type),
        ).fetchall()
    return [row[0] for row in rows] if rows else None
