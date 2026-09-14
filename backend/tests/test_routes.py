import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_locations_route(client):
    response = client.get("/api/locations")
    assert response.status_code == 200
    data = response.json()
    assert len(data["locations"]) == 8
    assert data["locations"][0]["id"] == "hou"


def test_bill_route(client):
    payload = {
        "location_id": "nyc",
        "building_type": "SmallOffice",
        "monthly_kwh": 3000,
        "tariff_id": "standard",
    }
    response = client.post("/api/bill", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert "bill" in body
    assert body["bill"]["annual"]["total"] > 0


def test_real_api_operator_route(client):
    response = client.get("/ecservice/api/operators")
    assert response.status_code == 200
    body = response.json()
    assert len(body["operators"]) == 7


def test_calculate_custom_economy_matches_the_real_calc_engine(client):
    payload = {
        "distributor_id": "nyc",
        "distributor_tariff_id": "standard",
        "usage_by_month": [3000.0] * 12,
    }
    response = client.post("/ecservice/calculate_custom_economy", json=payload)
    assert response.status_code == 200
    body = response.json()

    # A flat-rate tariff doesn't care about hourly shape, only total usage --
    # this should land on exactly the same total as /api/bill for the same
    # tariff/location/annual usage.
    bill_response = client.post("/api/bill", json={
        "location_id": "nyc", "building_type": "SmallOffice",
        "monthly_kwh": 3000, "tariff_id": "standard",
    })
    assert body["retailAnnualCosts"] == pytest.approx(bill_response.json()["bill"]["annual"]["total"])
    assert body["batteryDetails"] is None
    assert body["usage_by_month"] == payload["usage_by_month"]


def test_calculate_custom_economy_requires_distributor_id(client):
    response = client.post("/ecservice/calculate_custom_economy", json={"distributor_tariff_id": "standard"})
    assert response.status_code == 400


def test_calculate_custom_economy_rejects_unknown_tariff(client):
    payload = {"distributor_id": "nyc", "distributor_tariff_id": "not-a-real-tariff"}
    response = client.post("/ecservice/calculate_custom_economy", json=payload)
    assert response.status_code == 404


def test_calculate_custom_economy_battery_duration_reduces_demand_charges(client):
    payload = {
        "distributor_id": "nyc",
        "distributor_tariff_id": "demand",
        "usage_by_month": [3000.0] * 12,
        "battery_duration": "4",
        "battery_id": 0,
    }
    response = client.post("/ecservice/calculate_custom_economy", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["batteryDetails"]["duration"] == 4.0
    assert len(body["batteryMonthlyCosts"]) == 12
    assert len(body["batteryNetSavings"]) == 12

    # "" is the real API's documented sentinel for "no battery" -- must not
    # error (battery_duration used to be typed as int, which would reject it).
    no_battery = dict(payload, battery_duration="")
    response2 = client.post("/ecservice/calculate_custom_economy", json=no_battery)
    assert response2.status_code == 200
    assert response2.json()["batteryDetails"] is None
