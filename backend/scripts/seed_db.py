"""Provision the ClarityGrid schema and load it with synthetic data.

Uses the same generators as the in-process cache (app.services.prices /
app.services.usage / app.data.tariffs) so the seeded rows are consistent
with what the API computes -- this is a data dump of those generators into
Postgres, not an independent dataset.

Usage:
    DATABASE_URL=postgresql://user:pass@host:5432/dbname uv run python scripts/seed_db.py
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg
from dotenv import load_dotenv
from psycopg.types.json import Jsonb

from app.data.locations import LOCATIONS
from app.data.building_profiles import BUILDING_SHAPES
from app.data.tariffs import build_tariffs
from app.models.domain import Location
from app.services.prices import CAL, generate_hourly_prices
from app.services.usage import generate_hourly_usage

DEFAULT_MONTHLY_KWH = 3000.0
SERIES_YEAR = 2025  # CAL starts on a Wednesday, matching Jan 1 2025


def _to_location(raw: dict) -> Location:
    return Location(
        id=raw["id"], city=raw["city"], state=raw["state"], iso=raw["iso"],
        utility=raw["utility"], price_level=raw["price_level"], map_x=raw["map_x"], map_y=raw["map_y"],
    )


def series_timestamps() -> list[datetime]:
    start = datetime(SERIES_YEAR, 1, 1, tzinfo=timezone.utc)
    return [start + timedelta(hours=idx) for idx in range(len(CAL))]


def load_schema(conn: psycopg.Connection) -> None:
    schema_sql = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(schema_sql)
    conn.commit()


def seed_locations_and_tariffs(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("TRUNCATE tariffs, locations RESTART IDENTITY CASCADE")
        for ordinal, raw in enumerate(LOCATIONS):
            cur.execute(
                """
                INSERT INTO locations (id, ordinal, city, state, iso, utility, price_level, map_x, map_y)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (raw["id"], ordinal, raw["city"], raw["state"], raw["iso"], raw["utility"],
                 raw["price_level"], raw["map_x"], raw["map_y"]),
            )
            location = _to_location(raw)
            for tariff in build_tariffs(location):
                charges_json = Jsonb({
                    "customer": {
                        "basis": tariff.charges.customer.basis,
                        "range": [{"cost": t.cost, "from": t.from_} for t in tariff.charges.customer.range],
                    },
                    "energy": [
                        {
                            "basis": c.basis,
                            "range": [{"cost": t.cost, "from": t.from_} for t in c.range],
                            "time_period": None if c.time_period is None else {
                                "hours": c.time_period.hours,
                                "days_of_week": c.time_period.days_of_week,
                            },
                        }
                        for c in tariff.charges.energy
                    ],
                    "demand": None if tariff.charges.demand is None else {
                        "basis": tariff.charges.demand.basis,
                        "range": [{"cost": t.cost, "from": t.from_} for t in tariff.charges.demand.range],
                    },
                })
                cur.execute(
                    """
                    INSERT INTO tariffs (location_id, id, name, blurb, charges)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (location.id, tariff.id, tariff.name, tariff.blurb, charges_json),
                )
    conn.commit()
    print(f"seeded {len(LOCATIONS)} locations and their tariffs")


def copy_series(conn: psycopg.Connection, table: str, columns: list[str], rows) -> int:
    count = 0
    with conn.cursor() as cur:
        with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row)
                count += 1
    return count


def seed_price_series(conn: psycopg.Connection) -> None:
    timestamps = series_timestamps()
    with conn.cursor() as cur:
        cur.execute("TRUNCATE price_series")
    conn.commit()
    total = 0
    for raw in LOCATIONS:
        prices = generate_hourly_prices(raw["iso"], raw["id"])
        rows = ((raw["id"], ts, price) for ts, price in zip(timestamps, prices))
        total += copy_series(conn, "price_series", ["location_id", "ts", "price"], rows)
        conn.commit()
    print(f"seeded {total} price_series rows across {len(LOCATIONS)} locations")


def seed_usage_series(conn: psycopg.Connection) -> None:
    timestamps = series_timestamps()
    with conn.cursor() as cur:
        cur.execute("TRUNCATE usage_series")
    conn.commit()
    total = 0
    building_types = list(BUILDING_SHAPES.keys())
    for raw in LOCATIONS:
        for building_type in building_types:
            usage = generate_hourly_usage(building_type, DEFAULT_MONTHLY_KWH, raw["id"])
            rows = (
                (raw["id"], building_type, ts, kwh)
                for ts, kwh in zip(timestamps, usage)
            )
            total += copy_series(conn, "usage_series", ["location_id", "building_type", "ts", "kwh"], rows)
            conn.commit()
    print(
        f"seeded {total} usage_series rows across {len(LOCATIONS)} locations x "
        f"{len(building_types)} building types (at {DEFAULT_MONTHLY_KWH:.0f} kWh/month)"
    )


def main() -> None:
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL environment variable is required")

    with psycopg.connect(database_url) as conn:
        load_schema(conn)
        seed_locations_and_tariffs(conn)
        seed_price_series(conn)
        seed_usage_series(conn)

    print("done")


if __name__ == "__main__":
    main()
