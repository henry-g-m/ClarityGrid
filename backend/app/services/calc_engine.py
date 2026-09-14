from __future__ import annotations

from app.data.tariffs import build_tariffs
from app.models.domain import Charge, ChargeTier, Location, Tariff
from app.services.prices import CAL

# Demand bases where the peak (and thus the charge) is measured per-day and
# summed over the month, instead of once against the month's single highest
# peak. See docs/05-basis-reference.md #3 (`daily_peak_kw` / `daily_peak_kw_tr`).
DAILY_DEMAND_BASES = {"daily_peak_kw", "daily_peak_kw_tr"}


def evaluate_tiered_range(range_values: list[ChargeTier], x: float) -> float:
    applicable = range_values[0]
    for tier in range_values:
        if x >= tier.from_:
            applicable = tier
    return applicable.cost


def _energy_charge_for_hour(line: Charge, usage: float, price: float, month_usage_kwh: float, day_usage_kwh: float) -> float:
    """One hour's contribution to a single energy charge line, honoring
    feedin_rate (export credit), ndx (index/pass-through pricing), and
    daily_kwh_tr (tiered by the day's running usage instead of the month's)
    ahead of the default monthly-tiered rate."""
    if usage < 0 and line.feedin_rate > 0:
        return usage * line.feedin_rate
    if line.ndx:
        return usage * price
    if line.basis == "daily_kwh_tr":
        return usage * evaluate_tiered_range(line.range, day_usage_kwh)
    return usage * evaluate_tiered_range(line.range, month_usage_kwh)


def calculate_bill(tariff: Tariff, usage_arr: list[float], price_arr: list[float]) -> dict:
    monthly = [
        {"customer": 0.0, "energy": 0.0, "demand": 0.0, "total": 0.0, "wholesale": 0.0, "usage_kwh": 0.0, "peak_kw": 0.0}
        for _ in range(12)
    ]
    demand = tariff.charges.demand
    demand_is_daily = demand is not None and demand.basis in DAILY_DEMAND_BASES

    day_usage_by_line: dict[int, float] = {}
    day_peak_kw = 0.0

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
        if usage > day_peak_kw:
            day_peak_kw = usage

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
            day_total = day_usage_by_line.get(id(line), 0.0) + usage
            day_usage_by_line[id(line)] = day_total
            m["energy"] += _energy_charge_for_hour(line, usage, price, m["usage_kwh"], day_total)

        if hour == 23 or idx == len(CAL) - 1:
            if demand_is_daily:
                rate = evaluate_tiered_range(demand.range, day_peak_kw)
                m["demand"] += rate * day_peak_kw
            day_peak_kw = 0.0
            day_usage_by_line = {}

    for month_index in range(12):
        monthly[month_index]["customer"] = evaluate_tiered_range(tariff.charges.customer.range, monthly[month_index]["usage_kwh"])
        if demand is not None and not demand_is_daily:
            rate = evaluate_tiered_range(demand.range, monthly[month_index]["peak_kw"])
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
