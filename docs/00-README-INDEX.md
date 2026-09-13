# Clarity Grid API — Documentation Index

Source: https://claritygrid.net/api-documentation/ (crawled 2026-09-10)

Clarity Grid Solutions is an energy-data company. Their API extracts, transforms,
and loads (a) electric utility tariffs (rate plans) for US distributors (lower
48 + Australia), (b) wholesale prices from the 7 US ISOs (Independent System
Operators), and (c) hourly usage data — and lets you calculate/compare
electric bills using all three.

## Base hosts
- **Auth + most APIs:** `https://map.claritygrid.net` (path prefix `/ecservice/...`)
- **Interactive/live demo:** `https://api.claritygrid.net/`

## Files in this folder
| File | Covers |
|---|---|
| `01-quickstart-auth.md` | Account setup, login/auth flow, response format, HTTP status codes, sample Python |
| `02-tariff-api.md` | Distributor-by-zipcode, distributors-by-ISO, distributor-tariffs endpoints |
| `03-tariff-rate-elements.md` | `view_tariff_details` endpoint + full charge-object field reference |
| `04-usage-input.md` | 3 ways to supply usage data (NREL building profiles, CSV upload, manual estimate) |
| `05-basis-reference.md` | The "basis" codes that describe how each charge type is calculated (huge reference table) |
| `06-bill-calculations.md` | `calculate_economy_tariff_prices` + `calculate_custom_economy` (the core billing engine) endpoints |
| `07-nodal-api.md` | Wholesale/ISO node data: node library, day-ahead/real-time prices, ancillary services (per-ISO), congestion, load zones, 60-day data, MVA, aggregate load |
| `08-analytics.md` | Compare-to-wholesale, compare-two-tariffs, compare-to-battery, compare-to-solar — built on the bill calc endpoint with sample Python scripts |

## The 4 API Groups (per Clarity Grid's own organization)
1. **Tariff** — identify utilities/LSEs by territory, zip code, tariff, customer class
2. **Bill Calculations** — rate engine: calculate bills, "what-if" scenarios, tariff comparisons
3. **Analytics** — compare a calculated bill to Wholesale / Alternative Tariff / Battery / Solar
4. **Nodal** — wholesale node locations + pricing for the 7 US ISOs (NEISO, NYISO, PJM, MISO, CAISO, SPP, ERCOT — note SERC/WECC appear in one ISO-id list but the "7 ISOs" framing is used elsewhere)

## ISO / Operator IDs (from quickstart sample code)
1=NEISO, 2=NYISO, 3=PJM, 4=MISO, 5=CAISO, 6=SPP, 7=ERCOT, 8=SERC, 9=WECC

## Auth summary (see 01 for detail)
POST `https://map.claritygrid.net/ecservice/login` with `{"uu_id": "<api key>", "app_group": "API"}`
→ returns an auth cookie (`ecservicesessions`) used on all subsequent requests.

## Core entity relationships
```
Zipcode -> Distributor(s) [utility] -> Tariff(s) -> Tariff Detail (versioned by effective date)
                                                        |
                                          customer_charge / distribution_charge /
                                          demand_charge / energy_charge
                                                        |
                                          each charge has: basis code, range/tiers,
                                          components (breakdown), time_period, ndx flag

PriceNode (nodal) -> belongs to a Zone -> belongs to an Operator/ISO
                   -> has day-ahead price series, real-time price series,
                      ancillary service series (schema differs per ISO)
```

## Notes for building against this API
- All sample `curl`/session-cookie values in the docs are dummy/example values, not real credentials.
- Field naming is inconsistent in places (e.g., `operatorId` vs `operator_id`, `wholesaleAnnualCosts` vs `wholesaleAnualCosts` typo in real payload) — worth normalizing in any client/schema we build.
- Every "Sample Response" in the source docs is explicitly noted as "heavily condensed" — real responses have more entries in collections.
