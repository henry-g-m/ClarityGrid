from app.data.locations import LOCATIONS
from app.data.tariffs import build_tariffs
from app.models.domain import Location
from app.services.battery import find_shave_ceiling, simulate_battery
from app.services.calc_engine import calculate_bill
from app.services.prices import CAL, generate_hourly_prices
from app.services.usage import generate_hourly_usage


def _location() -> Location:
    return Location(**LOCATIONS[2])  # nyc


def _battery_usage(location: Location) -> tuple[list[float], list[float], list[float]]:
    usage = generate_hourly_usage("SmallOffice", 3000.0, location.id)
    prices = generate_hourly_prices(location.iso, location.id)
    battery_usage = simulate_battery(usage, prices, power_kw=15, duration_hr=4)
    return usage, prices, battery_usage


def test_find_shave_ceiling_stays_within_capacity_budget():
    day_usage = [10.0] * 24
    ceiling = find_shave_ceiling(day_usage, power_kw=5, capacity_kwh=20)
    shaved = sum(min(5.0, max(0.0, u - ceiling)) for u in day_usage)
    assert shaved <= 20 + 1e-6
    assert ceiling < 10.0


def test_battery_never_increases_the_daily_peak():
    location = _location()
    usage, _prices, battery_usage = _battery_usage(location)

    day_start = 0
    for idx, item in enumerate(CAL):
        if item["hour"] == 23 or idx == len(CAL) - 1:
            day_slice = slice(day_start, idx + 1)
            assert max(battery_usage[day_slice]) <= max(usage[day_slice]) + 1e-6
            day_start = idx + 1


def test_battery_conserves_or_increases_total_annual_usage():
    # Round-trip efficiency (0.9) means shifting usage can only add losses,
    # never create energy -- total annual usage with the battery in the loop
    # must be >= the unshifted total.
    location = _location()
    usage, _prices, battery_usage = _battery_usage(location)

    assert sum(battery_usage) >= sum(usage) - 1e-6


def test_battery_gives_no_benefit_on_a_flat_tariff():
    # A flat $/kWh rate doesn't care about timing, only total usage -- and the
    # battery's round-trip losses mean it can only match or slightly worsen
    # a flat-rate bill, never improve it. Matches the UI's own messaging.
    location = _location()
    usage, prices, battery_usage = _battery_usage(location)
    tariff = next(t for t in build_tariffs(location) if t.id == "standard")

    bill_without = calculate_bill(tariff, usage, prices)
    bill_with = calculate_bill(tariff, battery_usage, prices)

    assert bill_with["annual"]["total"] >= bill_without["annual"]["total"] - 1e-6


def test_battery_reduces_demand_charges_on_a_demand_tariff():
    location = _location()
    usage, prices, battery_usage = _battery_usage(location)
    tariff = next(t for t in build_tariffs(location) if t.id == "demand")

    bill_without = calculate_bill(tariff, usage, prices)
    bill_with = calculate_bill(tariff, battery_usage, prices)

    demand_without = sum(m["demand"] for m in bill_without["monthly"])
    demand_with = sum(m["demand"] for m in bill_with["monthly"])
    assert demand_with < demand_without


def test_battery_shifts_usage_toward_cheaper_hours():
    # Regardless of tariff, the battery should reduce the wholesale
    # (price-weighted) cost of the usage it touches -- that's the whole point
    # of recharging from the cheapest hours in each day.
    location = _location()
    usage, prices, battery_usage = _battery_usage(location)

    wholesale_without = sum(u * p for u, p in zip(usage, prices))
    wholesale_with = sum(u * p for u, p in zip(battery_usage, prices))
    assert wholesale_with < wholesale_without
