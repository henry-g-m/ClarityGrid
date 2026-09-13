# Tariff Rate Elements

Source: https://claritygrid.net/tariff-rate-elements/

## View Tariff Details (UI-facing, human-readable formatted version)

`POST https://map.claritygrid.net/ecservice/view_tariff_details`
Body: `{"distributor_tariff_id": 5005}`

This is the endpoint the Clarity Grid map UI uses to render a tariff's rate
detail nicely — same underlying data as `distributors/tariffs` but reshaped
with display-formatted "dataline"/"tierline" strings and human labels/units.

**Top-level:**
| Field | Type | Description |
|---|---|---|
| `utility` | string | Utility/distributor name |
| `tariff` | string | Tariff name |
| `effective` | string | Effective date |
| `revision_reason` | string | Reason for version |
| `Monthly Charges` | object | `{charges: [...]}` — fixed customer charges |
| `Distribution Charges` | object | `{charges: [...]}` |
| `Demand Charges` | object | `{charges: [...tiers...], tou: {...}}` |
| `Energy Charges` | object | `{charges: [...]}` |
| `notes` | string | Distributor applicability notes |
| `url` | string | Link to distributor's original tariff doc |

**Common charge fields:**
| Field | Type | Description |
|---|---|---|
| `ChargeLabel` | string | Label |
| `Unit` | string | Basis category (Fixed / Kilowatt Hours / Peak Kilowatts) |
| `number` | int | Display ordering |
| `cost` | float | Total rate |
| `unit` | string | `$/month`, `$/kWh`, `$/kW` |
| `dataline` | string | Preformatted UI display string |

**Distribution/Energy charge extras:**
| Field | Type | Description |
|---|---|---|
| `Breakdown` | array | `[{description, cost}]` — sub-components |
| `feedin_rate` (energy only) | float | AU feed-in credit rate |
| `ndx` (energy only) | bool | Index pricing flag |

**Demand charge extras — `tiers` array:**
| Field | Type | Description |
|---|---|---|
| `number` | int | Tier order |
| `from` / `to` | int | Tier bounds (kW) |
| `cost` | float | Rate |
| `unit` | string | `$/kW` |
| `tierline` | string | Preformatted display string |

Demand Charges object also includes a `tou` (time-of-use) sub-object keyed by
month+weekday/weekend label (e.g. `"Jan WeekDay"`) → nested arrays of period
indices.

### Sample (condensed)
```json
{
  "utility": "Consolidated Edison Co. Of NY-Zone J",
  "tariff": "C-9 Gen Serv -Low Tension (NYC Zone J)",
  "effective": "2023-01-01",
  "revision_reason": "Effective Date",
  "notes": "...",
  "Monthly Charges": {"charges": [
    {"Unit": "Fixed", "number": 1, "cost": 220.64, "unit": "$/month",
     "dataline": "Charge 1 [c](tou) :info: $ 220.640000 $/month"}
  ]},
  "Distribution Charges": {"charges": [
    {"ChargeLabel": "Total Dist($/kWh)", "Unit": "Kilowatt Hours", "number": 1,
     "Breakdown": [{"description": "Dist Cust Charge($/kWh)", "cost": 0.021}],
     "cost": 0.03871, "unit": "$/kWh",
     "dataline": "Charge 1 [d] :info: $ 0.038710 $/kWh"}
  ]},
  "Demand Charges": {
    "charges": [{
      "ChargeLabel": "Demand Charge($/kW) Rate E", "Unit": "Peak Kilowatts", "number": 2,
      "dataline": "Charge 2 [dct](tou) :info: ",
      "tiers": [{"number": 1, "from": 0, "to": 4, "cost": 0.0, "unit": "$/kW",
                 "tierline": " Tier 2-1 :info: From: 000000 To: 000004 0.000000 $/kW"}]
    }],
    "tou": {"Jan WeekDay": [[3]], "Jan WeekEnd": [[3]]}
  },
  "Energy Charges": {"charges": [
    {"ChargeLabel": "Total Energy ($/kWh)", "Unit": "Kilowatt Hours", "number": 1,
     "feedin_rate": 0.0, "ndx": true,
     "Breakdown": [{"description": "Energy-Merchant Function Charge ($/kWh)", "cost": 0.00101}],
     "cost": 0.01764, "unit": "$/kWh",
     "dataline": "Charge 1 [e] :info: $ 0.017640"}
  ]},
  "url": "http://url_link_to_distributors_documentation"
}
```

---

## Retrieve Operators

`GET https://map.claritygrid.net/ecservice/api/operators`

Returns the list of ISOs/Operators in the system.

| Field | Type | Description |
|---|---|---|
| `capacity_weight` | int | RFU |
| `name` | string | ISO name, e.g. "New England ISO" |
| `iso_prefix` | string | e.g. "neiso" |
| `id` | int | Clarity Grid ISO id |

```json
[{"capacity_weight": 1, "name": "New England ISO", "iso_prefix": "neiso", "id": 1}]
```
