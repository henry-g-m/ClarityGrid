from __future__ import annotations

from app.services.prices import CAL


def find_shave_ceiling(day_usage: list[float], power_kw: float, capacity_kwh: float) -> float:
    lo = 0.0
    hi = max(day_usage) if day_usage else 0.0
    for _ in range(40):
        mid = (lo + hi) / 2
        need = sum(min(power_kw, max(0.0, usage - mid)) for usage in day_usage)
        if need > capacity_kwh:
            lo = mid
        else:
            hi = mid
    return hi


def simulate_battery(usage_arr: list[float], price_arr: list[float], power_kw: float, duration_hr: int) -> list[float]:
    out = list(usage_arr)
    capacity_kwh = power_kw * duration_hr
    soc = capacity_kwh
    day_start = 0
    for idx, item in enumerate(CAL):
        if item["hour"] == 23 or idx == len(CAL) - 1:
            day_indices = list(range(day_start, idx + 1))
            day_usage = [usage_arr[j] for j in day_indices]
            budget = min(soc, capacity_kwh)
            ceiling = find_shave_ceiling(day_usage, power_kw, budget)
            discharged = 0.0
            for h in day_indices:
                amount = min(power_kw, max(0.0, out[h] - ceiling))
                out[h] -= amount
                discharged += amount
            soc -= discharged
            draw_needed = (capacity_kwh - soc) / 0.9
            by_price_asc = sorted(day_indices, key=lambda h: price_arr[h])
            for h in by_price_asc:
                if draw_needed <= 0:
                    break
                headroom = max(0.0, ceiling - out[h])
                draw = min(power_kw, draw_needed, headroom)
                out[h] += draw
                soc += draw * 0.9
                draw_needed -= draw
            day_start = idx + 1
    return out
