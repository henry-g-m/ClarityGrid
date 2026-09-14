import pytest

from app.models.domain import Charge, ChargeTier, Tariff, TariffCharges
from app.services.calc_engine import calculate_bill
from app.services.prices import CAL

HOURS_IN_YEAR = len(CAL)


def _flat_customer_charge() -> Charge:
    return Charge(basis="fixed", range=[ChargeTier(cost=0.0, from_=0.0)])


def test_index_pricing_uses_the_hourly_wholesale_price():
    # ndx=True means the energy charge is a pass-through of the hourly
    # wholesale price rather than a fixed $/kWh rate -- so it must exactly
    # match usage-weighted wholesale cost, regardless of the (unused) range.
    usage = [2.0] * HOURS_IN_YEAR
    prices = [0.05 + (i % 24) * 0.01 for i in range(HOURS_IN_YEAR)]
    tariff = Tariff(
        id="index",
        name="Index",
        blurb="",
        charges=TariffCharges(
            customer=_flat_customer_charge(),
            energy=[Charge(basis="kwh", range=[ChargeTier(cost=999.0, from_=0.0)], ndx=True)],
        ),
    )

    bill = calculate_bill(tariff, usage, prices)

    expected_energy = sum(u * p for u, p in zip(usage, prices))
    assert bill["annual"]["energy"] == pytest.approx(expected_energy)


def test_feedin_rate_credits_exported_usage():
    # Negative usage (export) is credited at feedin_rate instead of being
    # charged the normal tiered rate.
    usage = [-3.0] * HOURS_IN_YEAR
    prices = [0.10] * HOURS_IN_YEAR
    tariff = Tariff(
        id="feedin",
        name="Feed-in",
        blurb="",
        charges=TariffCharges(
            customer=_flat_customer_charge(),
            energy=[Charge(basis="kwh", range=[ChargeTier(cost=0.20, from_=0.0)], feedin_rate=0.05)],
        ),
    )

    bill = calculate_bill(tariff, usage, prices)

    expected_energy = sum(usage) * 0.05  # negative usage * positive rate = a credit
    assert bill["annual"]["energy"] == pytest.approx(expected_energy)
    assert bill["annual"]["energy"] < 0


def test_daily_kwh_tiered_resets_the_tier_every_day():
    # A tier that only kicks in after 5 kWh should apply in every single day
    # if usage resets daily, but would only apply once (near the end of the
    # year) if the tier were evaluated against cumulative monthly usage.
    usage = [0.0] * HOURS_IN_YEAR
    for idx, item in enumerate(CAL):
        if item["hour"] < 3:  # 3 kWh/day, split across the first 3 hours
            usage[idx] = 3.0
    prices = [0.0] * HOURS_IN_YEAR
    tariff = Tariff(
        id="daily-tiered",
        name="Daily tiered",
        blurb="",
        charges=TariffCharges(
            customer=_flat_customer_charge(),
            energy=[
                Charge(
                    basis="daily_kwh_tr",
                    range=[ChargeTier(cost=0.10, from_=0.0), ChargeTier(cost=0.50, from_=5.0)],
                )
            ],
        ),
    )

    bill = calculate_bill(tariff, usage, prices)

    days_in_year = 365
    # Each day: hour 0 -> 3kWh (tier1, running total 3) @ 0.10, hour 1 -> 3kWh
    # (running total 6, crosses the 5kWh tier) @ 0.50, hour 2 -> 3kWh @ 0.50.
    expected_per_day = 3.0 * 0.10 + 3.0 * 0.50 + 3.0 * 0.50
    assert bill["annual"]["energy"] == pytest.approx(expected_per_day * days_in_year)


def test_daily_peak_demand_charges_each_days_peak_separately():
    # A flat demand tariff with no time-of-day peak variation: if every day
    # has the same peak, the daily-basis charge should be exactly
    # (per-day peak * rate * number of days), not a single monthly-peak charge.
    usage = [0.0] * HOURS_IN_YEAR
    for idx, item in enumerate(CAL):
        usage[idx] = 4.0 if item["hour"] == 12 else 1.0
    prices = [0.0] * HOURS_IN_YEAR
    tariff = Tariff(
        id="daily-demand",
        name="Daily demand",
        blurb="",
        charges=TariffCharges(
            customer=_flat_customer_charge(),
            energy=[Charge(basis="kwh", range=[ChargeTier(cost=0.0, from_=0.0)])],
            demand=Charge(basis="daily_peak_kw", range=[ChargeTier(cost=2.0, from_=0.0)]),
        ),
    )

    bill = calculate_bill(tariff, usage, prices)

    days_in_year = 365
    assert bill["annual"]["demand"] == pytest.approx(4.0 * 2.0 * days_in_year)
    # A monthly-peak demand charge on the same usage would only charge the
    # peak once per month, not once per day -- confirm the daily basis
    # produces a materially larger total than that would.
    monthly_peak_equivalent = 4.0 * 2.0 * 12
    assert bill["annual"]["demand"] > monthly_peak_equivalent
