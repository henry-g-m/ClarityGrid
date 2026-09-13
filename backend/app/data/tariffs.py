from app.models.domain import Charge, ChargeTier, Location, Tariff, TariffCharges


def build_tariffs(location: Location) -> list[Tariff]:
    p = location.price_level
    return [
        Tariff(
            id="standard",
            name="Standard Flat",
            blurb="One flat rate, every hour.",
            charges=TariffCharges(
                customer=Charge(basis="fixed", range=[ChargeTier(cost=12 * p, from_=0.0)]),
                energy=[Charge(basis="kwh", range=[ChargeTier(cost=0.11 * p, from_=0.0)])],
                demand=None,
            ),
        ),
        Tariff(
            id="tou",
            name="Time-of-Use",
            blurb="Cheaper nights, pricier 2–8pm weekdays.",
            charges=TariffCharges(
                customer=Charge(basis="fixed", range=[ChargeTier(cost=10 * p, from_=0.0)]),
                energy=[
                    Charge(
                        basis="kwh",
                        range=[ChargeTier(cost=0.19 * p, from_=0.0)],
                        time_period={"hours": [14, 15, 16, 17, 18, 19], "days_of_week": [2, 3, 4, 5, 6]},
                    ),
                    Charge(basis="kwh", range=[ChargeTier(cost=0.075 * p, from_=0.0)]),
                ],
                demand=None,
            ),
        ),
        Tariff(
            id="demand",
            name="Commercial Demand",
            blurb="Lower energy rate, plus a monthly peak-kW charge.",
            charges=TariffCharges(
                customer=Charge(basis="fixed", range=[ChargeTier(cost=45 * p, from_=0.0)]),
                energy=[Charge(basis="kwh", range=[ChargeTier(cost=0.085 * p, from_=0.0)])],
                demand=Charge(basis="peak_kw", range=[ChargeTier(cost=16 * p, from_=0.0), ChargeTier(cost=11 * p, from_=50.0)]),
            ),
        ),
    ]
