from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.data.building_profiles import BUILDING_SHAPES, BUILDING_TYPES
from app.data.locations import LOCATIONS
from app.data.tariffs import build_tariffs
from app.models.domain import Location
from app.models.schemas import BillRequest, CompareRequest
from app.services.calc_engine import calculate_bill
from app.services.usage import generate_hourly_usage
from app.services.prices import generate_hourly_prices

router = APIRouter()


def _location_from_id(location_id: str) -> Location | None:
    for raw in LOCATIONS:
        if raw["id"] == location_id:
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
    return None


@router.get("/api/locations")
async def list_locations():
    return {"locations": LOCATIONS}


@router.get("/api/building-types")
async def list_building_types():
    return {"building_types": [{"key": key, "label": info["label"]} for key, info in BUILDING_SHAPES.items()]}


@router.get("/api/locations/{location_id}/tariffs")
async def get_location_tariffs(location_id: str):
    location = _location_from_id(location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    tariffs = build_tariffs(location)
    return {
        "location_id": location_id,
        "tariffs": [
            {
                "id": tariff.id,
                "name": tariff.name,
                "blurb": tariff.blurb,
                "annual_estimate": calculate_bill(
                    tariff,
                    generate_hourly_usage("SmallOffice", 3000.0, location.id),
                    generate_hourly_prices(location.iso, location.id),
                )["annual"]["total"],
            }
            for tariff in tariffs
        ],
    }


@router.get("/api/locations/{location_id}/prices")
async def get_location_prices(location_id: str, year: int | None = None):
    location = _location_from_id(location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    if year not in (None, 2025):
        raise HTTPException(status_code=400, detail="Only 2025 prices are supported in this MVP")
    return {"location_id": location_id, "year": 2025, "prices": generate_hourly_prices(location.iso, location.id)}


@router.post("/api/bill")
async def calculate_bill_endpoint(payload: BillRequest):
    location = _location_from_id(payload.location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    tariffs = build_tariffs(location)
    tariff = next((item for item in tariffs if item.id == payload.tariff_id), tariffs[0])
    usage = generate_hourly_usage(payload.building_type, payload.monthly_kwh, location.id)
    prices = generate_hourly_prices(location.iso, location.id)
    result = calculate_bill(tariff, usage, prices)
    return {
        "location": {"id": location.id, "city": location.city, "state": location.state},
        "tariff": {"id": tariff.id, "name": tariff.name},
        "usage": usage,
        "prices": prices,
        "bill": result,
    }


@router.post("/api/compare")
async def compare_locations(payload: CompareRequest):
    left_location = _location_from_id(payload.left.location_id)
    right_location = _location_from_id(payload.right.location_id)
    if left_location is None or right_location is None:
        raise HTTPException(status_code=404, detail="Location not found")

    left_tariffs = build_tariffs(left_location)
    right_tariffs = build_tariffs(right_location)
    left_tariff = next((item for item in left_tariffs if item.id == payload.left.tariff_id), left_tariffs[0])
    right_tariff = next((item for item in right_tariffs if item.id == payload.right.tariff_id), right_tariffs[0])

    left_usage = generate_hourly_usage(payload.left.building_type, payload.left.monthly_kwh, left_location.id)
    right_usage = generate_hourly_usage(payload.right.building_type, payload.right.monthly_kwh, right_location.id)
    left_prices = generate_hourly_prices(left_location.iso, left_location.id)
    right_prices = generate_hourly_prices(right_location.iso, right_location.id)

    return {
        "left": {
            "location": left_location.id,
            "tariff": left_tariff.id,
            "bill": calculate_bill(left_tariff, left_usage, left_prices),
        },
        "right": {
            "location": right_location.id,
            "tariff": right_tariff.id,
            "bill": calculate_bill(right_tariff, right_usage, right_prices),
        },
    }
