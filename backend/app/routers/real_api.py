from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import repositories
from app.data.iso_profiles import ISO_PROFILES
from app.models.schemas import CalculateCustomEconomyRequest

router = APIRouter()


@router.post("/ecservice/login")
async def login():
    return {"status": "ok", "session": "prototype-noauth", "user": "demo"}


@router.get("/ecservice/api/operators")
async def get_operators():
    return {
        "operators": [
            {"id": idx, "name": profile["name"], "code": key} for idx, (key, profile) in enumerate(ISO_PROFILES.items(), start=1)
        ]
    }


@router.get("/ecservice/api/distributor")
async def get_distributor(zipcode: str | None = None, operator_id: str | None = None):
    locations = repositories.list_locations()
    if zipcode:
        location = locations[0]
        return {"distributor": {"id": location.id, "zipcode": zipcode, "operator_id": operator_id or location.iso, "name": location.utility}}
    if operator_id:
        location = next((item for item in locations if item.iso == operator_id), locations[0])
        return {"distributor": {"id": location.id, "operator_id": operator_id, "name": location.utility}}
    return {"distributor": None}


@router.get("/ecservice/api/distributors")
async def get_distributors(operator_id: str | None = None):
    locations = repositories.list_locations()
    filtered = locations if operator_id is None else [item for item in locations if item.iso == operator_id]
    return {"distributors": [{"id": item.id, "name": item.utility, "operator_id": item.iso, "city": item.city, "state": item.state} for item in filtered]}


@router.get("/ecservice/api/distributors/tariffs")
async def get_distributor_tariffs(id: str | None = None):
    location_id = id or "nyc"
    location = repositories.get_location(location_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Location not found")
    tariffs = repositories.list_tariffs(location_id)
    return {
        "distributor": {"id": location.id, "name": location.utility},
        "tariffs": [
            {
                "id": tariff.id,
                "name": tariff.name,
                "blurb": tariff.blurb,
                "charges": {
                    "customer": tariff.charges.customer.__dict__,
                    "energy": [{"basis": c.basis, "range": [{"cost": tier.cost, "from": tier.from_} for tier in c.range], "time_period": None if c.time_period is None else {"hours": c.time_period.hours, "days_of_week": c.time_period.days_of_week}} for c in tariff.charges.energy],
                    "demand": None if tariff.charges.demand is None else {"basis": tariff.charges.demand.basis, "range": [{"cost": tier.cost, "from": tier.from_} for tier in tariff.charges.demand.range]},
                },
            }
            for tariff in tariffs
        ],
    }


@router.post("/ecservice/calculate_custom_economy")
async def calculate_custom_economy(payload: CalculateCustomEconomyRequest):
    if payload.distributor_tariff_id is None:
        raise HTTPException(status_code=400, detail="distributor_tariff_id is required")
    usage = payload.usage_by_month or [3000.0] * 12
    total_usage = sum(float(x) for x in usage)
    monthly_total = float(total_usage) * 0.14
    annual_total = monthly_total * 12
    return {
        "retailMonthlyCosts": [monthly_total / 12] * 12,
        "wholesaleMonthlyCosts": [monthly_total / 12 * 0.6] * 12,
        "annualRetailCost": annual_total,
        "annualWholesaleCost": annual_total * 0.6,
    }
