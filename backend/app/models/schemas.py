from __future__ import annotations

from pydantic import BaseModel, Field


class LocationOut(BaseModel):
    id: str
    city: str
    state: str
    iso: str
    utility: str
    price_level: float
    map_x: float
    map_y: float


class BuildingTypeOut(BaseModel):
    key: str
    label: str


class BillRequest(BaseModel):
    location_id: str
    building_type: str = "SmallOffice"
    monthly_kwh: float = 3000.0
    tariff_id: str = "standard"
    battery: dict | None = None
    fixed_rate: float | None = None


class CompareRequest(BaseModel):
    left: BillRequest
    right: BillRequest


class CalculateCustomEconomyRequest(BaseModel):
    usage_by_month: list[float] | None = Field(default_factory=list)
    distributor_tariff_id: str | None = None
    price_node_id: str | None = None
    battery_duration: int | None = None
    battery_id: str | None = None
    timezone: str | None = None


class TariffSummary(BaseModel):
    id: str
    name: str
    blurb: str
    annual_estimate: float
