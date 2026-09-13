# Tariff APIs

Source: https://claritygrid.net/tariff-apis/

Flow: authenticate → find distributor(s)/tariff(s) for a zip code → call the
detailed tariff endpoint with a specific `distributor_tariff_id`.

---

## 1. Retrieve Distributor Data By Zip Code

`GET https://map.claritygrid.net/ecservice/api/distributor?zipcode={zip}&operator_id={id}`

Headers: `Content-Type: application/json`, `ecservicesessions: <session cookie>`

Returns all distributors (+ their tariffs) for a given zip code.

**Response shape:**
| Field | Type | Description |
|---|---|---|
| `zipcode` | string | Selected zip |
| `city_name` | string | City for zip |
| `state_code` | string | 2-char state code |
| `latitude` / `longitude` | float | Zip coordinates |
| `distributors` | array | See Distributor object below |

**Distributor object:**
| Field | Type | Description |
|---|---|---|
| `id` | int | Clarity Grid distributor id |
| `name` | string | Distributor/utility name |
| `operator_id` | int | ISO this distributor belongs to |
| `tariffs` | array | See Tariff object below |

**Tariff object (summary form):**
| Field | Type | Description |
|---|---|---|
| `consumption_id` | int | 1 = Commercial, 2 = Residential |
| `consumption_name` | string | "Commercial" / "Residential" |
| `name` | string | Tariff name |
| `id` | int | Clarity Grid tariff id |
| `notes` | string | Distributor's applicability notes (free text) |

```json
{
  "zipcode": "10002", "city_name": "New York", "state_code": "NY",
  "latitude": 40.71704, "longitude": -73.987,
  "distributors": [{
    "id": 2298, "name": "Consolidated Edison Co. Of NY-Zone J", "operator_id": 2,
    "tariffs": [{
      "consumption_id": 2, "consumption_name": "Commercial",
      "name": "C-9 Gen Serv -Low Tension (NYC Zone J)", "id": 12138,
      "notes": "Low Tension Service ..."
    }]
  }]
}
```

---

## 2. Distributors By ISO

`GET https://map.claritygrid.net/ecservice/api/distributors?operator_id={id}`

Returns all distributors/utilities for a given ISO.

| Field | Type | Description |
|---|---|---|
| `user_id` | int | RFU (reserved for future use) |
| `operator_id` | int | ISO id |
| `name` | string | Distributor name |
| `id` | int | Distributor id |
| `state` | string | 2-char state code |
| `original_id` | int | RFU |
| `operator` | object | `{capacity_weight (int, RFU), name, iso_prefix, id}` |

```json
[{
  "user_id": 0, "operator_id": 2, "name": "Consolidated Edison Co. Of NY-Zone J",
  "id": 2298, "state": "NY", "original_id": 4226,
  "operator": {"capacity_weight": 1, "name": "New York ISO", "iso_prefix": "nyiso", "id": 2}
}]
```

---

## 3. Distributor Tariffs (detailed)

`GET https://map.claritygrid.net/ecservice/api/distributors/tariffs?id={distributor_id}`

Returns full rate detail for a distributor's tariffs — this is the richest
tariff object, with the actual charge structures.

**Top-level fields:**
| Field | Type | Description |
|---|---|---|
| `customer_charge` | array | Customer/fixed monthly charges (see below) |
| `distribution_charge` | array | Distribution charges ($/kWh) |
| `demand_charge` | array | Demand charges ($/kW) |
| `energy_charge` | array | Energy charges ($/kWh) |
| `distributor_id` | int | Distributor id |
| `tariff_name` | string | Tariff name |
| `effective_start_date` | string (YYYY-MM-DD) | Applies to usage after this date |
| `consumption_profile_id` | int | 1=Commercial, 2=Residential |
| `id` | int | Tariff id |
| `distributor_tariff_detail_id` | int | Id for this effective-date/version |
| `revision_reason` | string | Reason for this version |
| `notes` | object | `{notes, research_url}` — distributor's own docs |

### Charge object — common fields (appear on all 4 charge types)
| Field | Type | Description |
|---|---|---|
| `excess_pct` | int | N/A for most types |
| `chargeLabel` | string | Display label |
| `cpmin` | float | N/A for most types |
| `ndx` | bool | If true, hourly day-ahead wholesale price × usage is added to the charge (index pricing) |
| `cpmax_pct` | int | N/A for most types |
| `range` | array | Tiers: `[{cost, blcfctr, from}]` |
| `basis` | string | See `05-basis-reference.md` |
| `peak_interval` | int | Usually 60 (minutes) |
| `feedin_rate` | float | AU tariffs: $/kWh credited for excess power fed back to grid |
| `cpmin_pct` | int | N/A for most types |
| `time_period` | object | `{days_of_week[1-7,Sun=1], hours[0-23], months[1-12]}` — when the charge applies |

### `distribution_charge` and `energy_charge` also have:
| Field | Type | Description |
|---|---|---|
| `components` | array | `[{price, label}]` — informational breakdown, not used in calc |

### `demand_charge` also has:
| Field | Type | Description |
|---|---|---|
| `coincident_peak` | object | `{previous_months, cost, coincident_dates[epoch ms], year, percent}` |

### `range` (tier) object
| Field | Type | Description |
|---|---|---|
| `cost` | float | Rate for this tier |
| `blcfctr` | float | Block factor |
| `from` | int | Tier starting value (kW) |

```json
[{
  "notes": {"notes": "..."},
  "demand_charge": [{
    "excess_pct": 0, "chargeLabel": "Demand Charge($/kW) Rate E", "cpmin": 0,
    "ndx": false, "cpmax_pct": 0,
    "coincident_peak": {"previous_months": 0, "cost": 12.303,
      "coincident_dates": [1623758400000, 1626350400000], "year": 2022, "percent": 0},
    "range": [{"cost": 0, "blcfctr": 0, "from": 0}, {"cost": 31.13, "blcfctr": 0, "from": 5}],
    "basis": "peak_kw", "peak_interval": 60, "feedin_rate": 0, "cpmin_pct": 0,
    "time_period": {"months": [6,7,8,9]}
  }],
  "distributor_id": 2298, "tariff_name": "C-9 Gen Serv -Low Tension (NYC Zone J)",
  "effective_start_date": "2023-01-01",
  "customer_charge": [{
    "excess_pct": 0, "chargeLabel": "Total Dist Cust ($)", "cpmin": 0, "ndx": false,
    "cpmax_pct": 0, "range": [{"cost": 220.64, "blcfctr": 0, "from": 0}],
    "basis": "fixed", "peak_interval": 60, "feedin_rate": 0, "cpmin_pct": 0,
    "time_period": {"months": [6,7,8,9]}
  }],
  "energy_charge": [{
    "excess_pct": 0, "chargeLabel": "Total Energy ($/kWh)", "cpmin": 0,
    "components": [{"price": 0.00101, "label": "Energy-Merchant Function Charge ($/kWh)"}],
    "ndx": true, "cpmax_pct": 0, "range": [{"cost": 0.01764, "blcfctr": 0, "from": 0}],
    "basis": "kwh", "peak_interval": 60, "feedin_rate": 0, "cpmin_pct": 0
  }],
  "consumption_profile_id": 2,
  "distribution_charge": [{
    "excess_pct": 0, "chargeLabel": "Total Dist($/kWh)", "cpmin": 0,
    "components": [{"price": 0.021, "label": "Dist Cust Charge($/kWh)"}],
    "ndx": false, "cpmax_pct": 0, "range": [{"cost": 0.03871, "blcfctr": 0, "from": 0}],
    "basis": "kwh", "peak_interval": 60, "feedin_rate": 0, "cpmin_pct": 0
  }],
  "id": 12138, "distributor_tariff_detail_id": 77425, "revision_reason": "Effective Date"
}]
```
