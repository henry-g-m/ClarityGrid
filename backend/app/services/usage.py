from __future__ import annotations

from app.data.building_profiles import BUILDING_SHAPES
from app.services.prices import CAL, _hash_seed, _mulberry32


def generate_hourly_usage(building_type: str, monthly_avg_kwh: float, seed_str: str) -> list[float]:
    shape = BUILDING_SHAPES.get(building_type, BUILDING_SHAPES["SmallOffice"])
    rand = _mulberry32(_hash_seed(seed_str + building_type))
    raw: list[float] = []
    month_sums = [0.0] * 12
    for item in CAL:
        month = item["month"]
        dow = item["dow"]
        hour = item["hour"]
        is_weekend = dow == 1 or dow == 7
        base = shape["weekend"][hour] if is_weekend else shape["weekday"][hour]
        is_summer = 5 <= month <= 8
        is_winter = month == 11 or month <= 1
        seasonal = shape["summer_bump"] if is_summer else shape["winter_bump"] if is_winter else 1.0
        value = base * seasonal * (1 + (rand() - 0.5) * 0.08)
        raw.append(value)
        month_sums[month] += value

    out: list[float] = []
    for idx, item in enumerate(CAL):
        month = item["month"]
        if month_sums[month] == 0:
            out.append(0.0)
        else:
            out.append((raw[idx] / month_sums[month]) * monthly_avg_kwh)
    return out
