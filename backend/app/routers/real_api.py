from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import repositories
from app.data.iso_profiles import ISO_PROFILES
from app.models.schemas import CalculateCustomEconomyRequest
from app.observability import get_meter
from app.services.battery import simulate_battery
from app.services.calc_engine import calculate_bill
from app.services.prices import CAL

router = APIRouter()

_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# No per-node battery catalog exists in this prototype (the real API's
# `availableBatteries` / ancillary-service fields have no data source here) --
# "auto-select by duration" always resolves to this one representative unit.
_DEFAULT_BATTERY_POWER_KW = 15.0

_ecservice_calculations_counter = get_meter().create_counter(
    "claritygrid.ecservice_calculations",
    description="Number of /ecservice/calculate_custom_economy calls, by distributor tariff",
)


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


def _hourly_usage_from_monthly_totals(monthly_totals: list[float]) -> list[float]:
    """Spread each month's total evenly across every hour in that month --
    matches the real API's own documented behavior for manual monthly usage
    with no perHour detail supplied (docs/04-usage-input.md #3)."""
    hours_in_month = [days * 24 for days in _DAYS_IN_MONTH]
    return [monthly_totals[item["month"]] / hours_in_month[item["month"]] for item in CAL]


def _parsed_battery_duration_hr(raw: str | None) -> float | None:
    if raw in (None, "", "0"):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


@router.post("/ecservice/calculate_custom_economy")
async def calculate_custom_economy(payload: CalculateCustomEconomyRequest):
    if payload.distributor_id is None:
        raise HTTPException(
            status_code=400,
            detail="distributor_id is required (unlike the real API -- tariff ids "
            "like 'standard' aren't globally unique in this prototype's dataset, "
            "so the distributor is needed to resolve which one)",
        )
    if payload.distributor_tariff_id is None:
        raise HTTPException(status_code=400, detail="distributor_tariff_id is required")
    _ecservice_calculations_counter.add(1, {"distributor_tariff_id": payload.distributor_tariff_id})

    location = repositories.get_location(payload.distributor_id)
    if location is None:
        raise HTTPException(status_code=404, detail="Distributor not found")
    tariff = repositories.get_tariff(location.id, payload.distributor_tariff_id)
    if tariff is None:
        raise HTTPException(status_code=404, detail="distributor_tariff_id not found for this distributor")

    monthly_usage = [float(x) for x in payload.usage_by_month] if payload.usage_by_month else [3000.0] * 12
    if len(monthly_usage) != 12:
        raise HTTPException(status_code=400, detail="usage_by_month must have exactly 12 monthly totals")

    usage = _hourly_usage_from_monthly_totals(monthly_usage)
    prices = repositories.get_price_series(location.id)

    warnings = [
        "This prototype merges the real API's Distribution and Energy charge "
        "categories into one 'energy' charge -- retailMonthlyDistributionCosts "
        "and distributionChargeBasis are always zero/empty.",
        "price_node_id, solar fields, and ancillary-service fields are accepted but not modeled.",
    ]

    billed_usage = usage
    battery_details = None
    battery_monthly_costs = None
    battery_net_savings = None
    duration_hr = _parsed_battery_duration_hr(payload.battery_duration)
    if duration_hr is not None:
        billed_usage = simulate_battery(usage, prices, _DEFAULT_BATTERY_POWER_KW, duration_hr)
        baseline = calculate_bill(tariff, usage, prices)
        with_battery = calculate_bill(tariff, billed_usage, prices)
        battery_details = {
            "id": payload.battery_id if payload.battery_id is not None else 0,
            "duration": duration_hr,
            "name": f"{_DEFAULT_BATTERY_POWER_KW:.0f}kW / {duration_hr:.0f}hr representative unit",
            "disch_kwh": _DEFAULT_BATTERY_POWER_KW * duration_hr,
            "charging_kwh": _DEFAULT_BATTERY_POWER_KW * duration_hr,
        }
        battery_monthly_costs = [
            with_battery["monthly"][m]["total"] - baseline["monthly"][m]["total"] for m in range(12)
        ]
        battery_net_savings = [
            baseline["monthly"][m]["total"] - with_battery["monthly"][m]["total"] for m in range(12)
        ]
        warnings.append(
            "battery_id is not looked up against a real per-node catalog -- "
            "battery_duration alone selects this fixed representative unit."
        )

    result = calculate_bill(tariff, billed_usage, prices)
    wholesale_total = sum(m["wholesale"] for m in result["monthly"])

    return {
        "retailMonthlyCosts": [m["total"] for m in result["monthly"]],
        "retailAnnualCosts": result["annual"]["total"],
        "retailAnnualCostsCombined": result["annual"]["total"],
        "retailMonthlyDemandCosts": [m["demand"] for m in result["monthly"]],
        "retailMonthlyDistributionCosts": [0.0] * 12,
        "monthlyfixedCustomerCharge": [m["customer"] for m in result["monthly"]],
        "demandChargeBasis": [tariff.charges.demand.basis] if tariff.charges.demand else [],
        "distributionChargeBasis": [],
        "energyChargeBasis": [c.basis for c in tariff.charges.energy],
        "customerChargeBasis": [tariff.charges.customer.basis],
        "usage_by_month": monthly_usage,
        "wholesaleMonthlyCosts": [m["wholesale"] for m in result["monthly"]],
        "wholesaleAnualCosts": wholesale_total,  # sic -- matches the real API's documented (typo'd) field name
        "wholesaleAnnualCostsCombined": wholesale_total,
        "batteryDetails": battery_details,
        "batteryMonthlyCosts": battery_monthly_costs,
        "batteryNetSavings": battery_net_savings,
        "warning": " ".join(warnings),
    }
