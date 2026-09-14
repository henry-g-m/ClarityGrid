from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, HTTPException

from app import repositories
from app.data.building_profiles import BUILDING_SHAPES
from app.models.schemas import BillRequest, CompareRequest
from app.services.battery import simulate_battery
from app.services.calc_engine import calculate_bill, fixed_price_bill
from app.services.cache import get_or_generate_usage

router = APIRouter()


def _usage_for(location_id: str, building_type: str, monthly_kwh: float) -> list[float]:
    if building_type in repositories.SEEDED_BUILDING_TYPES and monthly_kwh == repositories.DEFAULT_MONTHLY_KWH:
        seeded = repositories.get_seeded_usage_series(location_id, building_type)
        if seeded is not None:
            return seeded
    return get_or_generate_usage(location_id, building_type, monthly_kwh)


@router.get("/api/locations")
async def list_locations():
    return {"locations": [asdict(location) for location in repositories.list_locations()]}


@router.get("/api/building-types")
async def list_building_types():
    return {"building_types": [{"key": key, "label": info["label"]} for key, info in BUILDING_SHAPES.items()]}


@router.get("/api/locations/{location_id}/tariffs")
async def get_location_tariffs(location_id: str):
    location = repositories.get_location(location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    tariffs = repositories.list_tariffs(location_id)
    prices = repositories.get_price_series(location_id)
    usage = _usage_for(location_id, "SmallOffice", repositories.DEFAULT_MONTHLY_KWH)
    return {
        "location_id": location_id,
        "tariffs": [
            {
                "id": tariff.id,
                "name": tariff.name,
                "blurb": tariff.blurb,
                "annual_estimate": calculate_bill(tariff, usage, prices)["annual"]["total"],
            }
            for tariff in tariffs
        ],
    }


@router.get("/api/locations/{location_id}/prices")
async def get_location_prices(location_id: str, year: int | None = None):
    location = repositories.get_location(location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    if year not in (None, 2025):
        raise HTTPException(status_code=400, detail="Only 2025 prices are supported in this MVP")
    return {"location_id": location_id, "year": 2025, "prices": repositories.get_price_series(location_id)}


@router.post("/api/bill")
async def calculate_bill_endpoint(payload: BillRequest):
    location = repositories.get_location(payload.location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    tariffs = repositories.list_tariffs(payload.location_id)
    if not tariffs:
        raise HTTPException(status_code=404, detail="No tariffs found for location")
    tariff = repositories.get_tariff(payload.location_id, payload.tariff_id) or tariffs[0]
    usage = _usage_for(location.id, payload.building_type, payload.monthly_kwh)
    prices = repositories.get_price_series(location.id)

    billed_usage = usage
    if payload.battery:
        power_kw = float(payload.battery.get("power_kw") or 0)
        duration_hr = float(payload.battery.get("duration_hr") or 0)
        if power_kw > 0 and duration_hr > 0:
            billed_usage = simulate_battery(usage, prices, power_kw, duration_hr)

    result = calculate_bill(tariff, billed_usage, prices)
    response = {
        "location": {"id": location.id, "city": location.city, "state": location.state},
        "tariff": {"id": tariff.id, "name": tariff.name},
        "usage": usage,
        "billed_usage": billed_usage,
        "prices": prices,
        "bill": result,
    }
    if payload.fixed_rate is not None:
        response["fixed_bill"] = fixed_price_bill(billed_usage, payload.fixed_rate / 100, 10)
    return response


@router.post("/api/compare")
async def compare_locations(payload: CompareRequest):
    left_location = repositories.get_location(payload.left.location_id)
    right_location = repositories.get_location(payload.right.location_id)
    if left_location is None or right_location is None:
        raise HTTPException(status_code=404, detail="Location not found")

    left_tariffs = repositories.list_tariffs(left_location.id)
    right_tariffs = repositories.list_tariffs(right_location.id)
    left_tariff = repositories.get_tariff(left_location.id, payload.left.tariff_id) or left_tariffs[0]
    right_tariff = repositories.get_tariff(right_location.id, payload.right.tariff_id) or right_tariffs[0]

    left_usage = _usage_for(left_location.id, payload.left.building_type, payload.left.monthly_kwh)
    right_usage = _usage_for(right_location.id, payload.right.building_type, payload.right.monthly_kwh)
    left_prices = repositories.get_price_series(left_location.id)
    right_prices = repositories.get_price_series(right_location.id)

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
