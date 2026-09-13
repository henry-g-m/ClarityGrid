# Overview of Basis (Charge Calculation Types)

Source: https://claritygrid.net/overview-of-basis/

Every charge (customer/distribution/demand/energy) has a `basis` code that
tells the calc engine *how* to apply the rate(s) in `range`/`components` to
usage or peak demand. This is the most important reference for building a
compatible calculation engine.

## 1) Customer Charge ($)
| Basis | Trace code | Description |
|---|---|---|
| `fixed` | c.t | Flat monthly charge regardless of usage. One item in `range`: `[{"cost":50,"blcfctr":0,"from":0}]` |
| `fixed_kwh` | ct.t | Tiered fixed charge based on monthly kWh — different flat $ depending which usage tier you fall in. Multiple `range` items, e.g. `[{"cost":50,"from":43},{"cost":150,"from":425}]` = $0 if <43kWh, $50 if 43–425kWh, $150 if >425kWh |

## 2) Distribution Charge ($/kWh)
| Basis | Trace code | Description |
|---|---|---|
| `kwh` | d.t | Flat $/kWh distribution charge. One `range` item. |
| `kwh` (tiered) | dt.t | $/kWh varies by usage volume tier within the month. Multiple `range` items by usage volume. |
| `peak_kw_bf` | dtb.t | Tiered by block factor: usage range = `0` up to `(monthly peak kW × block factor)`, each subsequent tier extends by another block-factor multiple, until all usage is assigned a tier. |
| `billdmd_bf` | dtbd.t | Similar to block-factor tiering but tier boundaries are `blcfctr × peak` OR flat notional kWh numbers. |
| `billdmd_bf_ratchet` | dtbr.t | Block-factor tiered, but the peak component used is `max(current month peak, avg peak over N trailing months × ratio)`. Ratchet params live in `coincident_peak: {previous_months, cost, percent}`. |

## 3) Demand Charge ($/kW)
| Basis | Trace code | Description |
|---|---|---|
| `peak_kw` (untiered) | dc.t | NCP (Non-Coincident Peak) monthly demand charge — single rate × monthly peak kW. |
| `peak_kw` (tiered) | dct.t | Same but rate varies by tier of peak usage — multiple `range` items. |
| `non_coincident_peak_ratchet` | dcr.t | NCP demand charge with ratchet: peak used = `max(current month peak, trailing-months avg × ratio)`. |
| `daily_peak_kw` | ddc.t | Like NCP demand, but peak is measured *each day*, not monthly. |
| `daily_peak_kw_tr` | ddct.t | Daily peak demand, tiered — starts above 0. |
| `dced` | dced.t | AU excess-demand charge: `(offPeakPeak − onPeakPeak) × rate` when off-peak peak exceeds on-peak peak. Requires TOU-defined on-peak window. |
| `x_coincident_peak` (formerly `one_/three_/four_/five_coincident_peak`) | dcXcp.t | CP (Coincident Peak) monthly demand charge — usage is the average of several published ISO "coincident peak" hours/days from the prior year. Dates live in `coincident_peak.coincident_dates` (epoch ms array). |
| `dmd_tiered_ratchet` | dctr.t | Tiered demand charge with ratchet: peak used = higher of current monthly peak or trailing-months avg × ratio (in `coincident_peak.percent` / `previous_months`). |

**Demand-charge-wide modifiers** (apply to any coincident-peak basis, when non-zero):
- `excess_pct` — excess demand = diff between highest 15-min metered demand and CP billing demand for the month; excess % is applied to (n% of CP value) vs (n% of current peak), using `curMonthDemandPeak − CP` if positive.
- `cpmax_pct` — peak-to-use = max of all CP values × this percentage.
- `cpmin` / `cpmin_pct` — e.g. contract demand = greater of `cpmin` kW or `cpmin_pct`% of highest 60-min coincident peak demand over current/preceding 12 billing months.

## 4) Energy Charge ($/kWh)
| Basis | Trace code | Description |
|---|---|---|
| `kwh` | e.t | Flat $/kWh × monthly usage. One `range` item. |
| `kwh` (tiered) | et.t | $/kWh varies by usage tier within the month. |
| `daily_kwh_tr` | etd.t | Tiered by *daily* usage totals, not monthly. |
| `peak_kw_bf` | etb.t | Tiered by block factor (peak kW × factor), same mechanic as distribution's block-factor tiering. |
| `billdmd_bf_ratchet` | etbr.t | Block-factor tiered with ratchet (same ratchet mechanic as distribution). |
| `offpeak_bf` | etopb.t | Block-factor tiers built from on-peak usage × block factor, then weighted by ratio of Off-Peak/Total usage. |
| `billdmd_bf` | etbd.t | Block-factor or notional-number tier boundaries. |
| `etabd` | (n/a) | Tiered by notional+block-factor value as tier bounds (both lower and upper). |
| any energy basis + `feedin_rate` > 0 | — | `feedin_rate` × sum of negative usage amounts = credited to the bill. |
| `e.ndx.t` (Index Pricing) | — | If `ndx: true`, hourly day-ahead wholesale prices × corresponding hourly usage are added into the energy charge. |

## 5) Other tariff charge elements
- **`components`** — informational-only breakdown of a charge into named sub-rates (`{price, label}`); not used in the actual bill math.
- **`time_period`** — restricts when a charge applies: `{days_of_week: [1=Sun..7=Sat], hours: [0-23], months: [1=Jan..12]}`. Charge (and any peak-finding) only considers usage within this window.
- **Tariff-detail-level attributes:** `id` (auto-increment tariff-detail row id, one per effective-date revision), `distributor_tariff_detail_id` (links revisions to the distributor), `revision_reason` (free text, e.g. "updated PPA"), `distributor_id`, `tariff_name`, `effective_start_date`, `notes: {notes, research_url}`.
