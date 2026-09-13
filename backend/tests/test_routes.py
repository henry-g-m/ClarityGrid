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
