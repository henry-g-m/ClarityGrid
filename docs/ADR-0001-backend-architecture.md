# ADR-0001: Backend Architecture & Deployment Platform for ClarityGrid Client

**Status:** Accepted
**Date:** 2026-09-10
**Deciders:** Project owner (solo prototype)

## Context

ClarityGrid Client is a prototype that models wholesale and retail
electricity pricing and lets a user run "what-if" scenarios (switch tariffs,
move to a fixed-rate plan, add battery storage, compare locations) — all on
entirely synthetic data shaped to resemble the real Clarity Grid Solutions
API we reverse-engineered from their public docs. It currently exists as a
single self-contained React artifact: the UI, the synthetic data generator,
and the bill-calculation engine (including a debugged battery
peak-shaving simulator) all run client-side in JavaScript.

The next step is to give it a real backend so the UI becomes a thin client
over an API, and to make it deployable rather than confined to an
artifact sandbox. This was worked out over several planning turns rather
than as one isolated question, so this ADR bundles the handful of
foundational choices that came out of that planning — language/framework,
database, cloud platform and compute, and infrastructure-as-code tool —
each documented as its own sub-decision below. It complements the detailed
working plan in `PLAN.md`, which has the full endpoint list, data model,
and phased sequencing; this document exists to make the *decisions*
themselves, and the reasoning behind them, easy to find and revisit later.

**Constraints going in:** solo developer, building with Claude Code, prior
experience/preference for Azure, wants a working prototype rather than a
production-hardened multi-tenant service, no fixed deadline but values fast
iteration.

## Decision

Build the backend in **Python with FastAPI**, port the existing JS
calc engine and synthetic dataset into it as plain Python data structures
(no DB yet), expose a **hybrid API** — endpoints shaped like the real
Clarity Grid API alongside a clean convenience layer for the UI — and
deploy it containerized to **Azure Container Apps**, provisioned via
**Bicep** through the Azure Developer CLI (`azd`). Persistence moves to
**standard PostgreSQL** (no extensions) in a later phase, once the
in-memory prototype is working end-to-end. The frontend becomes a
standalone **React + TypeScript** app (Vite, Tailwind, shadcn/ui, TanStack
Query, Framer Motion) hosted on Azure Static Web Apps.

## Options Considered

### Sub-decision 1: Backend language & framework

#### Option A: Python + FastAPI (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low — FastAPI's typing + automatic OpenAPI docs make the hybrid API easy to keep straight |
| Cost | N/A (language choice doesn't affect hosting cost) |
| Scalability | Fine at prototype scale; async support if it matters later |
| Team familiarity | Stated preference; also the natural home for the "basis code" calculation logic, which reads closer to the math it's modeling in Python than it did as inline JS |

**Pros:** direct 1:1 port target for the existing calc engine's logic; FastAPI gives free request/response validation via Pydantic, which would have caught at least one of the two bugs found while building the JS version (the unmultiplied demand-charge rate) at the schema level.
**Cons:** the frontend and backend are now different languages, so the calc engine's constants (seeds, tariff rates, ISO profiles) have to be kept in sync by hand during the port rather than shared by import.

#### Option B: Node.js + Express/Fastify
| Dimension | Assessment |
|---|---|
| Complexity | Low — could reuse the existing JS calc engine almost verbatim |
| Cost | N/A |
| Scalability | Comparable to FastAPI at this scale |
| Team familiarity | Not stated, but same language as the existing artifact |

**Pros:** near-zero porting effort — the validated JS engine could move over with minimal changes; one language across the whole stack.
**Cons:** loses the chance to add real typing/validation at the API boundary the way Pydantic gives essentially for free; not the stated preference.

**Trade-off:** Node would have been the lower-effort path given the working JS reference implementation already exists, but Python/FastAPI was the explicit starting requirement, and the Pydantic validation layer is a genuine correctness win for a calc engine that's already shown it can hide subtle bugs.

### Sub-decision 2: Database

#### Option A: Standard PostgreSQL, no extensions (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low — one well-understood engine, no extension management |
| Cost | Lowest of the three options |
| Scalability | Sufficient into the low millions of rows (dozens of locations × a few years × hourly ≈ well within reach) with a composite `(location_id, ts)` index and monthly partitioning if needed later |
| Team familiarity | High — plain SQL |

**Pros:** simplest operationally; one database for both the relational tariff/location data and the time-series price/usage data; Azure Database for PostgreSQL Flexible Server supports it natively with no extension allowlisting.
**Cons:** no built-in time-series conveniences (automatic compression, continuous aggregates, retention policies) if the dataset grows substantially.

#### Option B: PostgreSQL + TimescaleDB extension
| Dimension | Assessment |
|---|---|
| Complexity | Medium — hypertables and compression policies to configure and understand |
| Cost | Same base tier as Option A; specialized capability, not extra spend |
| Scalability | Better than plain Postgres at very large time-series volumes |
| Team familiarity | Lower — new concepts (hypertables, chunking) |

**Pros:** purpose-built for exactly the price/usage series half of this app's data; available on Azure Flexible Server (confirmed — corrected an earlier claim in planning that it wasn't).
**Cons:** unneeded complexity at current and near-term projected data volume; extension-aware major-version upgrades are more involved than plain Postgres.

#### Option C: Dedicated time-series DB (e.g. InfluxDB/QuestDB) + separate relational store
**Pros:** best-in-class time-series performance and retention tooling.
**Cons:** two databases to run, back up, and keep consistent for a dataset that doesn't remotely need it yet; clearly premature for a prototype.

**Trade-off:** Option A is correct *now* — the data volume doesn't justify Option B's complexity, and Option C's two-database split doesn't either. This isn't a permanent ceiling: Timescale is a config change on the same Azure resource if/when volume, retention policies, or continuous aggregates become genuinely useful, not a migration to different infrastructure.

### Sub-decision 3: Cloud platform & compute

#### Option A: Azure Container Apps (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium — requires a Dockerfile and image registry, but `azd` automates the rest |
| Cost | Scale-to-zero means near-zero cost when the prototype isn't in active use |
| Scalability | Room to add more services (a worker, a second API) without re-platforming |
| Team familiarity | New surface (Container Apps specifically), but standard Docker underneath |

**Pros:** serverless container hosting with scale-to-zero; official Microsoft `azd` templates exist for this exact FastAPI + Postgres combination (`azure-fastapi-postgres-addon-aca`); matches the stated intent to use Docker.
**Cons:** one more moving part (image build/push) than a source-deploy option.

#### Option B: Azure App Service (Linux, Python runtime)
**Pros:** simplest possible path — deploy straight from the repo, no Dockerfile needed.
**Cons:** doesn't match the stated Docker preference; likely to be outgrown once the frontend or a background worker joins the picture, at which point containerizing happens anyway.

#### Option C: Azure Kubernetes Service (AKS)
**Pros:** maximum flexibility and control.
**Cons:** significant operational overhead (cluster management, networking, upgrades) with no corresponding benefit at prototype scale — clear overkill for a single containerized API.

**Trade-off:** Container Apps sits at the right point on the complexity curve for this project — it's Docker-native (matching the stated preference) without AKS's operational burden, and it scales to zero, which matters for a prototype that won't run 24/7.

### Sub-decision 4: Infrastructure-as-code tool

#### Option A: Bicep (chosen, for now)
| Dimension | Assessment |
|---|---|
| Complexity | Low — Azure-native, integrates directly with `azd`'s default flow |
| Cost | N/A |
| Scalability/maturity | GA, Microsoft's primary IaC path for Azure |
| Team familiarity | Not previously stated; simpler syntax than Terraform for Azure-only resources |

**Pros:** the exact `azd` template we're scaffolding from (`azure-fastapi-postgres-addon-aca`) ships with Bicep, so this is zero-friction; `azd`'s CI/CD wiring (`azd pipeline config`) works out of the box without extra state configuration.
**Cons:** Azure-only — no portability if a multi-cloud need ever arises (not a current concern here).

#### Option B: Terraform
**Pros:** multi-cloud portability; broader ecosystem/tooling familiarity for teams that already use it elsewhere.
**Cons:** azd's Terraform support has remained in beta for a long time; no ready-made FastAPI+Postgres+Container-Apps Terraform template exists, so adopting it means hand-porting the Bicep resources rather than swapping in an equivalent; requires its own `az login` (separate from azd's credential handling) and remote state setup before CI/CD wiring works.

**Trade-off:** explicitly considered and set aside. Nothing about Terraform is disqualifying, but it adds setup cost (remote state, separate auth, manual porting) for a benefit (multi-cloud portability) that isn't currently needed. Revisit if a real multi-cloud requirement shows up — `azd` supports switching via `infra: provider: terraform` in `azure.yaml` without needing to change anything else about the project.

### Sub-decision 5: API design shape

#### Option A: Hybrid — real-shaped core + convenience layer (chosen)
**Pros:** `/ecservice/*` mirrors the real Clarity Grid API's paths and payload shapes (useful as a genuine mock of that API, and keeps the port grounded in real documented behavior); `/api/*` gives the UI single-call access to what it actually needs (e.g. one `POST /api/bill` instead of the real API's multi-step login → lookup → calculate flow).
**Cons:** two route groups to maintain instead of one; some logic (the calculation engine) is shared, but the request/response shaping is duplicated.

#### Option B: Mirror the real API only
**Pros:** single API surface; maximum fidelity to the documented Clarity Grid API.
**Cons:** forces the UI to replicate the real API's multi-step flow (authenticate, look up distributor, look up tariff, then calculate) for every interaction, which is more network round-trips than a UI-focused design needs.

#### Option C: Custom REST design only
**Pros:** simplest possible API, shaped purely around the UI's needs.
**Cons:** loses the fidelity to the real API that gives this project value as a documented, working model of how Clarity Grid's API actually behaves.

**Trade-off:** the hybrid costs some duplication but buys both things this project actually wants — a faithful mock of the real API's shape, and an efficient interface for the UI — where either pure option would have sacrificed one for the other.

## Consequences

- **Easier:** iterating on the calc engine and dataset (still in-memory Python, no migrations to manage yet); deploying with a single `azd up` once the Bicep is adjusted; keeping the mock API's fidelity to the documented real API for reference/comparison purposes.
- **Harder:** two route groups (`/ecservice/*` and `/api/*`) to keep in sync as the calc engine evolves; a future move to Terraform would be a hand-port, not a flag flip; the calc engine's constants now live in two languages (Python backend, TypeScript frontend reference) that have to be intentionally kept aligned during the port.
- **To revisit:**
  - Whether standard Postgres remains sufficient once real usage patterns and data volume are known (Timescale is available on the same Azure service if not).
  - Auth strategy — currently none, which is fine while nothing is publicly exposed, but must be addressed before any deployment beyond personal/internal use.
  - Whether the `/ecservice/*` mirror layer earns its ongoing maintenance cost once the UI is fully wired to `/api/*`, or whether it should be frozen/deprioritized at that point.

## Action Items

1. [ ] Port the JS calc engine and synthetic dataset (`reference/claritygrid-client-app.jsx`) into Python data structures and services (`backend/app/data/`, `backend/app/services/`)
2. [ ] Implement the hybrid FastAPI routes (`/ecservice/*`, `/api/*`) per `PLAN.md` section 6
3. [ ] Port the validated sanity checks (annual usage conservation, tariff totals, battery savings sign/magnitude per tariff type) into pytest
4. [ ] Scaffold `frontend/` (Vite + React + TypeScript + Tailwind + shadcn/ui + TanStack Query + Framer Motion) and port the UI off the reference JSX
5. [ ] Wire the frontend to `/api/bill` and friends, retiring the client-side calc path
6. [ ] `azd init` from `azure-fastapi-postgres-addon-aca`, adjust the Bicep for this project's resources, `azd up` in East US
7. [ ] Wire `FRONTEND_ORIGIN` from the Static Web App's generated domain into the Container App's environment (Bicep output-to-input reference, or a manual `azd env set` after first deploy)
8. [ ] Design the Postgres schema and Alembic migrations, seed from the current Python data structures (Phase 4 — not blocking the earlier items)
