# Nodal API

Source: https://claritygrid.net/nodal-api/

Covers "in front of the meter" wholesale economics: locations & pricing of
nodal points published by the 7 US ISOs, plus ancillary service pricing
(schema differs per ISO), congestion, load zones, and generation-resource data.

`node_type` / `price_node_type_id` legend used throughout:
`1=Load Point, 2=Unit, 3=Hub, 4=Load Zone, 5=Unknown, 6=Other, 7=Ancillary Service Zone`

`fuel_type` legend: `NG=Natural Gas, TH=Geothermal, N=Nuclear, B=Battery, BM=Bio-Mass, D=Distillates, H=Hydro, C=Coal, S=Solar, W=Wind`

---

## Node Library
Retrieve price nodes by ISO. Rich node object incl. location, identifying
codes (`cg_code`, `zone_cg_code`, `hub_cg_code`, `asz_cg_code`), owning
utility (`utility_eia_id`, `utility_name`), and current/historical pricing
(`price`, `zone_price`, `prevyear_average_dayahead_price`,
`nextday_average_dayahead_price`, `price_datetime`).

## Nodal Information
Retrieve price nodes by ISO + node type — similar object to Node Library but
uses `zone_id`/`hub_id`/`asz_id` (numeric ids) instead of `*_cg_id`, and adds
`has_prices` (bool), `is_location_valid`/`is_location_approved`/`is_approved`
(RFU ints), `capacity_zone_id` (RFU).

## Nodal Day-ahead Prices
Day-ahead price series for a node + date range: `[{"D": "YYYY-mm-dd HH:mm:ss", "P": price}]`

## Nodal Real-time Prices
Real-time price series for a node + date range: same shape as day-ahead — `{"D", "P"}`.

## Closest Nodes by Latitude and Longitude
Find nearest price nodes to a lat/lon (optionally filtered by zip and/or
operator_id). Richest node object — includes `congestion_price`,
`congestion_date`, both zone-level and node-level day-ahead price averages,
hub/asz linkage fields (`hub_node_id`, `hub_original_name`, `asz_id`, etc.).

## Ancillary Services (schema differs per ISO — separate real-time / day-ahead endpoints for most)

| ISO | Real-Time fields | Day-Ahead fields |
|---|---|---|
| **NEISO** | `price_datetime, tmsr, tmnsr, tmor, regcap, regsr` | `price_datetime, tmsr, tmnsr, tmor` |
| **NYISO** | `price_datetime, tmsr, tmnsr, oprsv, regcap, regmov` | `price_datetime, tmsr, tmnsr, oprsv, regcap` |
| **PJM** | `price_datetime, rtorp, rtorc, rtosr, madsr, madpr, rtopr, rtotm` | `price_datetime, rtorp, rtorc, rtosr, madsr, madnsr, rtonsr` |
| **MISO** | *(single endpoint)* `price_datetime, demregmcp, demspinmcp, demsuppmcp, genregmcp, genspinmcp, gensuppmcp` | — |
| **CAISO** | *(single endpoint)* `price_datetime, ns, regdn, rmd, rmu, regup, spin` | — |
| **SPP** | *(single endpoint)* `price_datetime, regup, regdn, spin, supp` | — |
| **ERCOT** | *(single endpoint)* `price_datetime, rrs, regup, regdn, nspin, ecrs` | — |

Ancillary service definitions (abbreviated glossary from docs):
- `tmsr`/`rrs` (varies by ISO) — spinning reserve, respond within 10 min, sustain 30 min
- `tmnsr`/`nspin`/`ns` — non-synchronized reserve, respond within 10 min from offline
- `tmor`/`oprsv` — 30-min operating reserve
- `regcap`/`regup`/`regdn`/`rtorc`/`rtorp` — regulation capacity/up/down/performance
- `regmov` (NYISO only) — regulation movement (Real-Time market only)
- `supp`/`demsuppmcp`/`gensuppmcp` — supplemental reserve, not necessarily synced, 10 min
- `spin`/`demspinmcp`/`genspinmcp` — spinning reserve, synced, 10 min, run ≥2 hrs
- `ecrs` (ERCOT) — ERCOT Contingency Reserve Service

## Price Node Congestion
View congestion data for a price node — superset of the Node Library fields
plus `congestion_price`, `congestion_date`.

## Operator Load Zones
List load zones for an ISO: `{zipcode, zone_id, address, price_node_type_id,
load_points_count, operator_id, original_name, original_codename, latitude,
id, longitude}`

## Resources
Generation resources mapped to a gen node (mostly batteries in the sample):
`{operator_id, price_node_id, resource_name, original_codename, resource_type,
capacity, duration, capacity_mwh (=capacity×duration), notes, owner, address,
initial_charge, online_date}`

## 60-Day Data
Detailed hourly ERCOT-style generation-resource settlement data — dozens of
fields covering real-time/day-ahead settlement amounts, ancillary award
quantities and MCPCs (market clearing prices for capacity) per service type
(`regup`, `regdn`, `rrs`, `ecrs`, `nonspin`, etc.), `rt_price`, `rt_lambda`,
`fuel_type`, `settlement_point_name`, `delivery_date`, `hour`,
`price_node_id`, `resource_name`, `resource_type`, `rowtype`.
(See source doc for the full ~45-field table if this granularity is needed.)

## Apparent Power (MVA)
Given a node id, hourly apparent power: `[{"D": "YYYY-mm-dd HH:mm:ss", "P": MVA}]`

## Aggregate Load
15-minute aggregated load for a node: `{price_datetime, price_date_hr, agg_load}`
