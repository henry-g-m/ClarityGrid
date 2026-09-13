from app.data.locations import LOCATIONS
from app.data.tariffs import build_tariffs
from app.models.domain import Location
from app.services.calc_engine import calculate_bill
from app.services.prices import generate_hourly_prices
from app.services.usage import generate_hourly_usage


def test_price_and_usage_generation():
    location = Location(
        id="nyc",
        city="New York",
        state="NY",
        iso="nyiso",
        utility="Gotham Edison Company",
        price_level=1.3,
        map_x=82,
        map_y=30,
    )
    prices = generate_hourly_prices(location.iso, location.id)
    usage = generate_hourly_usage("SmallOffice", 3000.0, location.id)
    assert len(prices) == 8760
    assert len(usage) == 8760
    assert all(value > 0 for value in prices)
    assert sum(usage) > 0


def test_calculate_bill_matches_shape():
    location = Location(**LOCATIONS[2])
    tariffs = build_tariffs(location)
    bill = calculate_bill(tariffs[0], generate_hourly_usage("SmallOffice", 3000.0, location.id), generate_hourly_prices(location.iso, location.id))
    assert "monthly" in bill and "annual" in bill
    assert len(bill["monthly"]) == 12
    assert bill["annual"]["total"] > 0
