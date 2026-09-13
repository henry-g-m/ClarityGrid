from __future__ import annotations

from app.data.iso_profiles import ISO_PROFILES


def _hash_seed(value: str) -> int:
    h = 1779033703 ^ len(value)
    for ch in value:
        h = (h ^ ord(ch)) * 3432918353 & 0xFFFFFFFF
    return h


def _mulberry32(seed: int):
    state = seed & 0xFFFFFFFF

    def next_float() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((state ^ (state >> 15)) * (1 | state)) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * (61 | t))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) >>> 0) / 4294967296

    return next_float


def build_calendar() -> list[dict[str, int]]:
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    cal: list[dict[str, int]] = []
    dow = 4
    for month in range(12):
        for day in range(1, days_in_month[month] + 1):
            for hour in range(24):
                cal.append({"month": month, "dow": dow, "hour": hour})
            dow = (dow % 7) + 1
    return cal


CAL = build_calendar()


def generate_hourly_prices(iso_prefix: str, seed_str: str) -> list[float]:
    profile = ISO_PROFILES[iso_prefix]
    rand = _mulberry32(_hash_seed(seed_str + iso_prefix))
    out: list[float] = []
    for item in CAL:
        month = item["month"]
        hour = item["hour"]
        is_summer = 5 <= month <= 8
        is_winter = month == 11 or month <= 1
        seasonal = profile["summer_peak"] if is_summer else profile["winter_peak"] if is_winter else 1.0
        dist = abs(hour - profile["peak_hour"])
        daily = 1 + 1.4 * (2.718281828459045 ** (-(dist * dist) / 18))
        overnight_dip = 0.55 if 1 <= hour <= 5 else 1.0
        noise = 1 + (rand() - 0.5) * profile["volatility"]
        out.append(max(profile["base"] * seasonal * daily * overnight_dip * noise, 0.005))
    return out
