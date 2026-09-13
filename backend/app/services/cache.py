from __future__ import annotations

from app.data.locations import LOCATIONS
from app.data.tariffs import build_tariffs
from app.models.domain import Location
from app.services.prices import generate_hourly_prices
from app.services.usage import generate_hourly_usage

CACHE = {"prices": {}, "usage": {}}


def _to_location(raw: dict) -> Location:
    return Location(
        id=raw["id"],
        city=raw["city"],
        state=raw["state"],
        iso=raw["iso"],
        utility=raw["utility"],
        price_level=raw["price_level"],
        map_x=raw["map_x"],
        map_y=raw["map_y"],
    )


def warm_cache() -> None:
    for raw in LOCATIONS:
        location = _to_location(raw)
        CACHE["prices"][location.id] = generate_hourly_prices(location.iso, location.id)
        CACHE["usage"].setdefault(location.id, {})
        for building_name in ["SmallOffice", "Retail", "SmallHotel", "Warehouse", "MidriseApartment"]:
            CACHE["usage"][location.id][building_name] = {}


def get_location_by_id(location_id: str) -> Location | None:
    for raw in LOCATIONS:
        if raw["id"] == location_id:
            return _to_location(raw)
    return None


def get_tariffs_for_location(location_id: str):
    location = get_location_by_id(location_id)
    if location is None:
        return []
    return build_tariffs(location)
