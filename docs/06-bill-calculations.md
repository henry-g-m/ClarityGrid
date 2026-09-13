# Bill Calculations

Source: https://claritygrid.net/bill-calculations/

These endpoints are the rate engine: calculate past/current bills, run
"what-if" tariff scenarios, compare usage changes. Requires auth first.

Charge categories used throughout: **Distribution, Demand, Energy, Customer**.

## Data Definitions (glossary)
| Name | Description |
|---|---|
| distributor | Utility name |
| iso | ISO the utility is in |
| state | US state of the utility |
| eiaid | Unique EIA numerical id of the utility |
| zip code | Zip codes in the utility's service territory |
| charge category | Monthly / Distribution / Demand / Energy |

---

## 1. Calculate Economy Tariff Prices
Lists a tariff's rates within a date range (lighter-weight than the full bill calc).

**Top-level fields:** `customerCharge`, `distributionCharge`, `demandCharge`,
`energyCharge` — each an array of monthly-rate objects — plus `operatorId` (int).

**Charge-collection item (shared shape across all 4 charge types):**
| Field | Type | Description |
|---|---|---|
| `month` | int | Effective month |
| `year` | int | Effective year |
| `tariffEnergyCharges` | string | JSON-encoded string of the raw tariff energy-charge object (only populated for energy) |
| `chargeRange` | array | `[{blockFactor, cost, percentage, from, to}]` |

```json
{
  "distributionCharge": [{"month": 2, "year": 2023, "tariffEnergyCharges": "",
    "chargeRange": [{"blockFactor": 0, "cost": 0.03871, "percentage": 0, "from": 0, "to": 0}]}],
  "demandCharge": [{"month": 2, "year": 2023, "tariffEnergyCharges": "",
    "chargeRange": [
      {"blockFactor": 0, "cost": 7.97, "percentage": 0, "from": 0, "to": 0},
      {"blockFactor": 0, "cost": 0.0, "percentage": 0, "from": 0, "to": 4},
      {"blockFactor": 0, "cost": 24.59, "percentage": 0, "from": 5, "to": 0}
    ]}],
  "energyCharge": [{"month": 2, "year": 2023,
    "tariffEnergyCharges": "[{...full charge object as escaped JSON string...}]",
    "chargeRange": [{"blockFactor": 0, "cost": 0.01764, "percentage": 0, "from": 0, "to": 0}]}],
  "customerCharge": [{"month": 2, "year": 2023, "tariffEnergyCharges": "",
    "chargeRange": [{"blockFactor": 0, "cost": 177.85, "percentage": 0, "from": 0, "to": 0}]}],
  "operatorId": 2
}
```

---

## 2. Calculate Custom Economy — the core billing endpoint
This is the main endpoint: given a tariff + usage (+ optional price node/battery/solar
params — see `04-usage-input.md` for the request payload), it returns retail AND
wholesale cost breakdowns for the whole year, plus hourly calculation detail.

### Response fields (retail-focused; wholesale/battery/solar fields flagged, detailed in `08-analytics.md`)

| Field | Type | Description |
|---|---|---|
| `retailMonthlyCosts` | array[12] float | Total retail cost per month |
| `retailAnnualCosts` | float | Total annual retail cost |
| `retailAnnualCostsCombined` | float | Combined annual retail cost |
| `retailMonthlyDemandCosts` | array[12] float | Monthly retail demand-charge cost |
| `retailMonthlyDistributionCosts` | array[12] float | Monthly retail distribution-charge cost |
| `monthlyfixedCustomerCharge` | array[12] float | Monthly fixed customer charge |
| `monthlyfixed4CPCharge` | array[12] float | *(deprecated)* |
| `demandChargeBasis` / `distributionChargeBasis` / `energyChargeBasis` / `customerChargeBasis` | array[string] | Basis code(s) in effect — see `05-basis-reference.md` |
| `monthlyDemandComponents` / `monthlyDistributionComponents` / `monthlyEnergyComponents` | array | `[{component_type, components: [{month, price, label}], month}]` — informational breakdown |
| `usage` | object | `{"<epoch ms>": kWh}` hourly usage echoed back |
| `usage_by_month` | array | Echoed input |
| `totalFeedInkWh` | float | Total AU feed-in kWh |
| `warning` | string | Any calc warnings |
| `building_filename` / `building_url` | string | NREL building file used, if applicable |
| `calculationValuesPerHour` | array | Per-hour breakdown: `{demandCharge, energyCharge, distributionCharge, usage, nodePrice, timeOfUsage, capacityRate, capacityCharge, nonSeePee, as_1..as_6}` |
| `traceText` | array | `[{Month, Traces: [<preformatted trace strings>]}]` — human-readable calc trace, one entry per charge line, tilde-delimited |
| `passThruComponents` | array | ISO pass-through charge components |
| `wholesale*` fields | — | **Analytics-only**, see `08-analytics.md` |
| `battery*` / `as*tot` / `AS_columns` / `availableBatteries` | — | **Analytics-only (battery)**, see `08-analytics.md` |
| `monthlyPPA` / `ppacost` | — | **Analytics-only (solar)**, see `08-analytics.md` |

### `calculationValuesPerHour` item fields
| Field | Type | Description |
|---|---|---|
| `demandCharge` | float | Calculated demand $ for the hour |
| `energyCharge` | float | Calculated energy $ for the hour |
| `distributionCharge` | float | Calculated distribution $ for the hour |
| `timeOfUsage` | string | `YYYY-MM-DD HH:MM:SS` |
| `usage` | float | kWh for the hour |
| `nodePrice` | float | Wholesale price at node for the hour |
| `capacityRate` / `capacityCharge` | float | Capacity charge info |
| `nonSeePee` | float | RFU |
| `as_1`..`as_6` | float | Ancillary service amounts (analytics/battery) |

### `traceText` format
Each trace line is a `~`-delimited string roughly:
`<datetime if hourly>~<peak-to-date>~<usage-to-date>~$<computed $>~<ChargeLabel>|<params>~<trace-code>~<rate>`
Designed to be pasted into a crosstab for auditing exactly how a charge was computed.
Trace codes match the ones in `05-basis-reference.md` (e.g. `c.t`, `d.1`, `d.t`, `e.ndx.t`, `dct.t`).
