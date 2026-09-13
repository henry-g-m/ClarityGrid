# Usage Input Methods

Source: https://claritygrid.net/usage/

The bill-calculation endpoints need usage data as input. There are 3 ways to supply it.

## 1. NREL Building Profiles (easiest — auto-fills usage)
Set `building` to one of these standard DOE/NREL commercial reference building types:
`FullServiceRestaurant`, `Hospital`, `LargeHotel`, `LargeOffice`, `MediumOffice`,
`MidriseApartment`, `OutPatient`, `PrimarySchool`, `QuickServiceRestaurant`,
`SecondarySchool`, `SmallHotel`, `SmallOffice`, `Stand-aloneRetail`, `StripMall`,
`SuperMarket`, `Warehouse`

Also set `building_from` / `building_to` (MM/YYYY strings) for the desired period,
and `latitude`/`longitude` (used to pick the geographically appropriate building file).
`usage_by_month` and `hourly_customer_load` can be left empty/blank.

```json
{
  "price_node_id": 111687, "usage_by_month": [], "distributor_id": "",
  "distributor_tariff_id": "12166", "latitude": 0, "longitude": 0,
  "hourly_customer_load": {}, "battery_duration": "",
  "building": "LargeHotel", "building_from": "01/2023", "building_to": "03/2023"
}
```

## 2. Actual Usage Upload (CSV)
CSV format required: `mm/dd/yyyy, hh:mm, kWh(usage)` e.g. `1/1/2020, 01:00, 2385`

Parse each row into `hourly_customer_load` (key = datetime string, value = kWh),
then sum hourly values per month into `usage_by_month`. `perHour` can be left blank
for this method.

```json
{
  "price_node_id": 111687,
  "usage_by_month": [{
    "startDate": "2021-11-01", "endDate": "2021-11-30", "usage": "10010.376881720322",
    "actual_usage": true, "year": "2021", "month": "11", "perHour": {}
  }],
  "distributor_id": "", "distributor_tariff_id": "12166",
  "latitude": 0, "longitude": 0,
  "hourly_customer_load": {"2021-11-01 00:00": 5.32333333333327},
  "battery_duration": ""
}
```

## 3. Manual/Estimated Monthly Usage
Fill `usage_by_month`, set `actual_usage: false`. To fill `perHour`: divide the
month's total usage by the number of days in the month, use that value for
every hour in the month.

```json
{
  "price_node_id": 111687,
  "usage_by_month": [{
    "startDate": "2023-01-01", "endDate": "2023-01-31", "usage": "10000",
    "actual_usage": false, "year": "2023", "month": "01",
    "perHour": {"2023-01-01 00:00": 13.440860215053762}
  }],
  "distributor_id": "", "distributor_tariff_id": "12166",
  "latitude": 0, "longitude": 0, "hourly_customer_load": {}, "battery_duration": ""
}
```

## Field reference (shared payload — used by the bill calculation endpoints)
| Field | Type | Description |
|---|---|---|
| `price_node_id` | int | Clarity Grid id of the desired wholesale price node |
| `usage_by_month` | array | Monthly usage objects (see below) |
| `distributor_id` | string | Distributor id (not required by API) |
| `distributor_tariff_id` | string | Tariff to run the bill against |
| `latitude` / `longitude` | float | Price node location; also picks NREL building file |
| `hourly_customer_load` | object | `{"<date hh:mm>": kWh}` — actual usage |
| `battery_duration` | string | See Analytics doc |
| `building` | string | NREL building type (omit if not using NREL) |
| `building_from` / `building_to` | string (MM/YYYY) | NREL usage period (omit if not using NREL) |

**`usage_by_month` item fields:** `startDate`, `endDate`, `usage` (string kWh),
`actual_usage` (bool), `year`, `month`, `perHour` (object of `{"<date hh:mm>": kWh}`)
