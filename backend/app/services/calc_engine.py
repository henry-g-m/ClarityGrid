from __future__ import annotations

from app.data.tariffs import build_tariffs
from app.models.domain import ChargeTier, Location, Tariff
from app.services.prices import CAL


def evaluate_tiered_range(range_values: list[ChargeTier], x: float) -> float:
    applicable = range_values[0]
    for tier in range_values:
        if x >= tier.from_:
            applicable = tier
    return applicable.cost


def calculate_bill(tariff: Tariff, usage_arr: list[float], price_arr: list[float]) -> dict:
    monthly = [
        {"customer": 0.0, "energy": 0.0, "demand": 0.0, "total": 0.0, "wholesale": 0.0, "usage_kwh": 0.0, "peak_kw": 0.0}
        for _ in range(12)
    ]

    for idx, item in enumerate(CAL):
        month = item["month"]
        dow = item["dow"]
        hour = item["hour"]
        usage = usage_arr[idx]
        price = price_arr[idx]
        m = monthly[month]
        m["usage_kwh"] += usage
        m["wholesale"] += usage * price
        if usage > m["peak_kw"]:
            m["peak_kw"] = usage

        matched = None
        fallback = None
        for line in tariff.charges.energy:
            if line.time_period is None:
                fallback = line
                continue
            if line.time_period.hours and line.time_period.days_of_week and hour in line.time_period.hours and dow in line.time_period.days_of_week:
                matched = line
                break
        line = matched or fallback
        if line is not None:
            m["energy"] += usage * evaluate_tiered_range(line.range, m["usage_kwh"])

    for month_index in range(12):
        monthly[month_index]["customer"] = evaluate_tiered_range(tariff.charges.customer.range, monthly[month_index]["usage_kwh"])
        if tariff.charges.demand is not None:
            rate = evaluate_tiered_range(tariff.charges.demand.range, monthly[month_index]["peak_kw"])
            monthly[month_index]["demand"] = rate * monthly[month_index]["peak_kw"]
        monthly[month_index]["total"] = (
            monthly[month_index]["customer"] + monthly[month_index]["energy"] + monthly[month_index]["demand"]
        )

    annual = {
        "customer": sum(m["customer"] for m in monthly),
        "energy": sum(m["energy"] for m in monthly),
        "demand": sum(m["demand"] for m in monthly),
        "total": sum(m["total"] for m in monthly),
        "wholesale": sum(m["wholesale"] for m in monthly),
        "usage_kwh": sum(m["usage_kwh"] for m in monthly),
    }
    return {"monthly": monthly, "annual": annual}


def fixed_price_bill(usage_arr: list[float], rate_per_kwh: float, monthly_fee: float) -> dict:
    monthly = [{"total": 0.0, "usage_kwh": 0.0} for _ in range(12)]
    for idx, item in enumerate(CAL):
        month = item["month"]
        monthly[month]["usage_kwh"] += usage_arr[idx]
    for month_index in range(12):
        monthly[month_index]["total"] = monthly_fee + monthly[month_index]["usage_kwh"] * rate_per_kwh
    annual = sum(item["total"] for item in monthly)
    return {"monthly": monthly, "annual": annual}
