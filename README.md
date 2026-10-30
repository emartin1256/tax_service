# Tax service

## Purpose and architecture

Novabook tax service is a **modular monolith** built with **NestJS** and **PostgreSQL** (via Prisma). It ingests sale and tax-payment events, applies sale amendments over time, and answers **tax position** queries at any effective timestamp. Tax is computed in the domain layer from stored events; there is **no running balance** column—position is derived when queried.

Interactive API documentation (Swagger UI) is available at **`/docs`** when the service is running.

## Prerequisites

- **Node.js 24.15+** (see `.nvmrc`; NestJS 12 and `package.json` `engines` require 24.15.0 or newer)
- **Docker** (local PostgreSQL via Compose)
- **npm**

Real database URLs, Neon credentials, and GCP keys are **never** committed to this repository.

## Environment variables

Copy `.env.example` to `.env` for local development. Placeholder values point at the local Compose Postgres instance:

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | HTTP port (default `3000` locally; Cloud Run uses `8080`) |
| `DATABASE_URL` | Pooled Postgres URL for the app |
| `DIRECT_DATABASE_URL` | Direct Postgres URL (migrations; defaults to `DATABASE_URL` if omitted) |
| `LOG_LEVEL` | Pino log level |
| `OTEL_ENABLED` | `true` to export OpenTelemetry traces and metrics via OTLP to Google Cloud |

Example placeholders (from `.env.example`):

```env
DATABASE_URL=postgresql://tax:tax@localhost:5432/tax_service?schema=public
DIRECT_DATABASE_URL=postgresql://tax:tax@localhost:5432/tax_service?schema=public
```

Production runtime `DATABASE_URL` lives in **Google Secret Manager** (`database-url`), not in GitHub.

## Local PostgreSQL

```bash
docker compose up -d
cp .env.example .env
npx prisma migrate deploy
npm run start:dev
```

The init script `docker/postgres/init-test-db.sh` creates **`tax_service_test`** only on a **fresh** Docker volume (for integration tests). To wipe local data and re-apply migrations:

```bash
npx prisma migrate reset
```

`migrate reset` is **destructive** and intended for **local** use only.

## Commands

| Command | Description |
|---------|-------------|
| `npm run lint` | Oxlint on `src/` and `test/` |
| `npm run format:check` | Prettier check |
| `npm run typecheck` | TypeScript `--noEmit` |
| `npm test` | Unit and e2e Jest projects |
| `npm run test:integration` | Integration tests (**requires Postgres**, typically `tax_service_test`) |
| `npm run build` | Nest production build |

## API

**Money in requests:** all **costs**, **amounts**, and line items are **integer pennies** (signed 32-bit, including zero and negative values).

**Money in responses:** `taxPosition` is a JSON **number in pounds**, not pennies. For example, 49 pennies of tax is returned as **`0.49`**, not `49`. (The original brief annotates `"taxPosition": 49 // £0.49` in the same style as `"cost": 1099 // £10.99`; this service returns **`0.49`**.)

Response `date` fields use canonical UTC ISO 8601; **`.000` milliseconds are omitted** when zero.

### POST `/transactions` — sale

```bash
curl -s -X POST http://localhost:3000/transactions \
  -H 'Content-Type: application/json' \
  -d '{
    "eventType": "SALES",
    "date": "2024-01-01T00:00:00Z",
    "invoiceId": "inv-1",
    "items": [
      { "itemId": "A", "cost": 1000, "taxRate": 0.2 },
      { "itemId": "B", "cost": 333, "taxRate": 0.2 }
    ]
  }'
```

Success: **202** with no body.

### POST `/transactions` — tax payment

```bash
curl -s -X POST http://localhost:3000/transactions \
  -H 'Content-Type: application/json' \
  -d '{
    "eventType": "TAX_PAYMENT",
    "date": "2024-01-15T00:00:00Z",
    "amount": 100
  }'
```

Success: **202** with no body.

### GET `/tax-position`

```bash
curl -s 'http://localhost:3000/tax-position?date=2024-01-10T00:00:00Z'
```

Worked example (after the sale above, then payment and amend steps below):

| Query `date` | Expected `taxPosition` (pounds) |
|--------------|----------------------------------|
| `2024-01-01T00:00:00Z` | `2.67` |
| `2024-01-10T00:00:00Z` | `2.67` |
| `2024-01-15T00:00:00Z` (after payment 100 pennies) | `1.67` |
| `2024-01-20T00:00:00Z` | `1.67` |
| `2024-02-01T00:00:00Z` (after amend below) | `-0.13` |

Example response body:

```json
{
  "date": "2024-01-10T00:00:00Z",
  "taxPosition": 2.67
}
```

### PATCH `/sale`

```bash
curl -s -X PATCH http://localhost:3000/sale \
  -H 'Content-Type: application/json' \
  -d '{
    "date": "2024-02-01T00:00:00Z",
    "invoiceId": "inv-1",
    "itemId": "A",
    "cost": 100,
    "taxRate": 0.2
  }'
```

Success ingest and amend: **202** with no body.

## Rounding

Per line item, tax in pennies uses **decimal.js** with **`ROUND_HALF_UP`** (ties away from zero), then items are summed, then the position is exposed in pounds (divide by 100). Do not use `Math.round`.

Examples:

- `1099 × 0.2 = 219.8` → **220** pennies  
- `5 × 0.5 = 2.5` → **3** pennies  

## Temporal rules

- Events have an **effective time** (`date` in the payload) and an **ingestion time** (`ingested_at` at store time).
- Queries at time **T** include only events with **`effectiveAt <= T`**.
- An **amendment alone** does not create tax until a matching sale line exists; once the sale is effective, amendments apply.
- The **latest** amendment for an `(invoiceId, itemId)` wins by ordering **`(effectiveAt, ingestedAt, sequence)`** and replaces **both cost and rate**.
- A **late sale** does not overwrite amendments already stored.
- Equal effective timestamps: prefer **later ingest**, then **higher sequence**.
- **Future-dated** events are excluded until **T** reaches their effective time.

## Validation and duplicates

- Malformed input → **400**.
- Identifiers are strings up to **128** characters (not necessarily UUIDs).
- Tax rate **≥ 0**, at most **8** decimal places, **no maximum** rate.
- Sale lines are unique on **`(invoiceId, itemId)`**.
- **Identical** sale replay → **202**, no double-count.
- Same line with different cost, rate, or effective date → **409**; client must **`PATCH /sale`**.
- **Every tax payment is stored**; retries **double-count** (there is **no event id**).

## Deployment

| Item | Value |
|------|--------|
| GCP project ID | `tax-service-513123` |
| GCP project number | `338378273837` |
| Region | `us-central1` |
| Cloud Run service | `tax-service` |

**Billing** on the GCP project must be confirmed **before** `terraform apply` (not verified by this repo).

**Neon** Postgres is created **manually**, not by Terraform:

1. Confirm GCP billing.
2. Create the Neon database; store the **pooled** connection string in Secret Manager as secret **`database-url`** (add a secret **version** by hand—Terraform creates the secret only).
3. From `infra/terraform`, run `terraform apply` with your GitHub repo set, e.g.  
   `TF_VAR_github_repository=your-org/tax_service terraform apply`  
   (`github_repository` has **no default** so plan/apply fails closed until set.)
4. Configure GitHub **variables** and **secrets** (below).
5. Set **`DEPLOY_ENABLED=true`** when ready to deploy on push to `main`.
6. Run the **Deploy** workflow (or push to `main` with deploy enabled).

Terraform state is **local** (`.terraform/`, `*.tfstate*` are gitignored). **CI does not apply** Terraform; apply is **manual**.

### GitHub repository variables

Configure under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Example / notes |
|----------|------------------|
| `GCP_PROJECT_ID` | `tax-service-513123` |
| `GCP_PROJECT_NUMBER` | `338378273837` |
| `GCP_REGION` | `us-central1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | From Terraform output `workload_identity_provider` after apply |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | `tax-service-deployer@tax-service-513123.iam.gserviceaccount.com` |
| `CLOUD_RUN_SERVICE` | `tax-service` |
| `DEPLOY_ENABLED` | `false` by default; set to `true` to deploy on push to `main` |

**Secret:** `DIRECT_DATABASE_URL` — Neon **direct** URL for **`prisma migrate deploy`** in the deploy workflow only. Runtime uses Secret Manager, not GitHub.

Deploy uses **Workload Identity Federation** (GitHub OIDC → `tax-service-deployer`). **No** service-account JSON keys in the repo or workflows.

## CI and deploy workflows

- **`ci.yml`** (pull requests and push to `main`): lint, format, typecheck, Postgres 16 service, `prisma migrate deploy`, unit/e2e/integration tests, `prisma validate`, build, **`docker build`** (no push). Does **not** deploy.
- **`terraform.yml`** (manual): `terraform fmt -check` and `terraform validate` with `init -backend=false`. Does **not** plan or apply.
- **`deploy.yml`** (manual, or push to `main` when **`DEPLOY_ENABLED=true`**): WIF auth, build/push image tagged with **`github.sha`**, migrate with `DIRECT_DATABASE_URL`, update Cloud Run, curl **`/health/ready`** with retries. If deploy is disabled on push, the workflow prints a clear skip notice.

Until **`DEPLOY_ENABLED=true`**, deploy on push stays **idle**.

## Observability

- **JSON** structured logs with **request id** and **redaction** of sensitive fields.
- **`GET /health/live`** — process up (no database).
- **`GET /health/ready`** — database reachable; failures log a fixed message (and Prisma **code** only when present), not connection strings.
- **OpenTelemetry** when **`OTEL_ENABLED=true`**, exporting traces and metrics with **OTLP** to **Google Cloud**.
- Cloud Run provides request count, latency, CPU, and memory in GCP Monitoring.
- **Neon** free tier may **suspend** after ~5 minutes idle; readiness may **503** until the database wakes—retries are expected.

If **`/health/ready`** returns **503** in production: check Secret Manager `database-url`, Neon status, and Cloud Run logs; verify migrations ran via the deploy workflow.

## Cost and security

This stack is **not** guaranteed free.

- **Cloud Run:** request-based billing, **min 0** / **max 2** instances, **us-central1**; charges possible for CPU/memory during requests, image storage over free tiers, or egress beyond free allowances.
- **Artifact Registry:** cleanup policy retains a small number of images; storage above free limits may cost.
- A **GCP billing account** is required. Set a **small billing budget** in the Google Cloud console.
- **Neon** free tier limits (confirm current Neon docs): e.g. CU-hours, storage, egress; suspension instead of overage billing on free tier.

The HTTP API is **public and unauthenticated** per the product brief. **Do not** put real taxpayer data in it.

## Infrastructure code

Terraform lives in **`infra/terraform/`** (Google provider): APIs, Artifact Registry, runtime and deployer service accounts, GitHub WIF, Secret Manager secret **`database-url`**, and a bootstrap Cloud Run service (hello image; deploy workflow updates the real image). The bootstrap revision uses a **TCP startup probe on port 8080** so the placeholder hello image can become ready (it does not serve `/health/live`). After deploy pushes the real application image, the **Deploy** workflow still verifies **`GET /health/ready`** on the service URL.

```bash
cd infra/terraform
terraform fmt -recursive
terraform init -backend=false
terraform validate
# apply only after billing, Neon, and TF_VAR_github_repository are set — never from CI
```

Do **not** commit `.env`, secret values, or service-account keys.
