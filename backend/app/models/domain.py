from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TimePeriod:
    hours: list[int] | None = None
    days_of_week: list[int] | None = None


@dataclass
class ChargeTier:
    cost: float
    from_: float


@dataclass
class Charge:
    basis: str = "kwh"
    range: list[ChargeTier] = field(default_factory=list)
    time_period: TimePeriod | None = None
    ndx: bool = False
    feedin_rate: float = 0.0


@dataclass
class TariffCharges:
    customer: Charge
    energy: list[Charge]
    demand: Charge | None = None


@dataclass
class Tariff:
    id: str
    name: str
    blurb: str
    charges: TariffCharges


@dataclass
class Location:
    id: str
    city: str
    state: str
    iso: str
    utility: str
    price_level: float
    map_x: float
    map_y: float
