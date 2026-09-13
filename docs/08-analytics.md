# Analytics

Source: https://claritygrid.net/analytics/

All analytics features are built on top of the **Calculate Custom Economy**
endpoint (`06-bill-calculations.md`) — same endpoint, extra request fields
unlock extra response fields. No separate endpoint URLs.

## 1. Compare To Wholesale (default — no extra input needed)
Every bill calc automatically returns wholesale-comparison fields alongside retail:

| Field | Type | Description |
|---|---|---|
| `wholesalePrices` | object | `{"<epoch ms>": price}` hourly wholesale rate at the node |
| `wholesaleMonthlyCapacityCost` | array[12] float | Monthly capacity cost |
| `wholesaleAnnualCosts` | float | Annual wholesale cost (note: real payload key is typo'd `wholesaleAnualCosts`) |
| `wholesaleMonthlyCosts` | array[12] float | Monthly wholesale cost |
| `wholesaleMonthlyDistributionCosts` | array[12] float | Monthly wholesale distribution cost |
| `wholesaleAnnualCostsCombined` | float | Combined annual wholesale cost |
| `wholesaleMonthlyDemandCosts` | array[12] float | Monthly wholesale demand cost |
| `averageNextDayaheadPrice` | float | Average next-day day-ahead price |

## 2. Compare Two Tariffs
No special fields — just call Calculate Custom Economy twice with different
`distributor_tariff_id` values (same usage profile both times) and diff the results.

**Pattern (from sample Python in source doc):**
1. Login once, reuse the auth cookie for both calls.
2. Build one `usage_by_month` list (+ optional `perHour`) shared by both payloads.
3. Set `params1['distributor_tariff_id']` / `params2['distributor_tariff_id']` to the two tariffs being compared.
4. `POST /ecservice/calculate_custom_economy` twice, compare responses.

## 3. Compare to Battery
Add these fields to the payload to run a bill *with* a battery:

| Field | Type | Description |
|---|---|---|
| `battery_duration` | string | Discharge duration in hours, e.g. `"4"` |
| `battery_id` | int | Specific battery id, or `0` to auto-select by duration |

**Battery-related response fields:**
| Field | Type | Description |
|---|---|---|
| `batteryDispatchHours` | array[int 0-23] | Hours the battery discharges |
| `batteryChargingHours` | array[int 0-23] | Hours the battery charges |
| `batteryNetSavings` | array float | Net $ savings from using the battery |
| `availableBatteries` | array | `[{duration, charging_kwh, cost, name, disch_kwh, id}]` — all battery options at this node |
| `batteryDetails` | object | Same shape as one `availableBatteries` entry — the battery actually used |
| `batteryMonthlyCosts` | array[12] float | Monthly cost of the battery |
| `as1tot`..`as6tot` | float | Total revenue per ancillary service (battery providing AS) |
| `AS_columns` | array[string] | Names of the up-to-6 ancillary services for this ISO (order matches `as1..as6`) |

## 4. Compare to Solar
Add these fields to the payload to run a bill *with* solar (PPA-style):

| Field | Type | Description |
|---|---|---|
| `battery_duration` | string | Set to `"0"` when doing solar-only |
| `battery_id` | int | `0` |
| `additional_fixed_charge` | float | Extra $ added to fixed monthly charges |
| `ppa` | float | Power Purchase Agreement rate, $/kWh |
| `system_size` | int | DC system size in kW |

**Solar-related response fields:**
| Field | Type | Description |
|---|---|---|
| `monthlyPPA` | array[12] float | PPA cost per month |
| `ppacost` | float | Sum of `monthlyPPA` |

---

## Sample Python pattern (shared by all 3 comparison types)
All three sample scripts in the source docs follow the same shape:
1. `POST /ecservice/login` with `{"uu_id": apikey, "app_group": "API"}` → get `authcookie`.
2. Build a synthetic hourly usage profile by looping months/days/hours between a
   `startDate`/`endDate`, dividing `monthlyUsg` evenly across days-in-month × 24 hours.
3. Build one baseline payload and one "variant" payload (different tariff / +battery / +solar fields).
4. `POST /ecservice/calculate_custom_economy` for each, check `response.text != "{Unauthorized}"`.
5. Diff/compare the two JSON responses.

Real example distributor_tariff_ids referenced in the docs: `5927` (R-6 TOU) and
`200` (R-1) — both for Central Hudson Gas & Electric Corp. in NYISO, price_node_id `2966`.
