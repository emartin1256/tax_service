# Tax service

NestJS service with PostgreSQL (Prisma). It ingests sales and tax payments, stores sale amendments, and returns the tax position at a requested instant. The position is calculated from stored events. There is no running balance, no user model, and no authentication.

Swagger UI is at `/docs`.

## Assumptions

### 1. Monetary values and tax rounding

`cost` and `amount` are integer pennies, stored as integers. The accepted range is a signed 32-bit integer, so zero and negative values are valid inputs. Tax is not calculated with floating-point currency.

Each item's tax is `cost × taxRate`, calculated with decimal.js and rounded to the nearest penny with `ROUND_HALF_UP` (ties away from zero). Item taxes are summed in pennies. Payments are subtracted in pennies. Division by 100 happens only when building the API response.

`taxPosition` is a JSON number in pounds. 49 pennies is `0.49`, not `49`. The brief's `"taxPosition": 49 // £0.49` comment uses the same annotation style as `"cost": 1099 // £10.99`. This service returns the pound amount.

Examples: `1099 × 0.2 = 219.8` rounds to 220 pennies. `5 × 0.5 = 2.5` rounds to 3 pennies.

### 2. Tax position is a point-in-time calculation

A query at time T includes sales, amendments, and payments whose effective time is less than or equal to T, including events at that exact timestamp. Later events are ignored. An amendment does not create tax by itself. It applies only once a matching sale line is also effective at T.

Comparisons use UTC instants. The response `date` is the requested instant in canonical UTC. Zero milliseconds are omitted (`2024-01-10T00:00:00Z`, not `...00.000Z`).

There are no financial years. The position accumulates for the life of the data.

### 3. Amendments are effective-dated overrides

An amendment applies from its own effective time onward. It does not rewrite earlier query results.

For one `(invoiceId, itemId)`, the winning amendment is the latest with `effectiveAt <= T`, ordered by `(effectiveAt, ingestedAt, sequence)`. A later ingest wins ties on effective time, then a higher sequence. A sale that arrives after amendments does not delete or replace those amendments.

### 4. Amendments replace item values

An amendment replaces both `cost` and `taxRate` for that item. It does not add another sale line or a separate adjustment.

The service stores an amendment even when the sale line does not exist yet. When that line is ingested later, the stored amendment takes effect for queries at or after the amendment's effective time.

### 5. Event ingestion and duplicate requests

`POST /transactions` and `PATCH /sale` return **202** with an empty body only after the database transaction commits.

Sale lines are unique on `(invoiceId, itemId)`. An identical replay of a stored line returns 202 and does not insert another row. The same line with a different cost, tax rate, or effective time returns **409**. The client amends it with `PATCH /sale`.

Tax payments have no event id. Every accepted payment is stored, so a retry counts again. Amendments are append-only. A repeated amendment is another row, and the ordering rule in assumption 3 decides which one wins.

### 6. Validation and error handling

Requests must be valid JSON. `date` must be an ISO 8601 instant with a timezone (`Z` or a numeric offset). `invoiceId` and `itemId` are non-blank strings of at most 128 characters. They are not required to be UUIDs.

`taxRate` must be finite and greater than or equal to zero, with at most 8 decimal places. There is no maximum. Zero and rates above 100% are accepted. The service does not apply a tax-law cap.

Invalid requests return **400**. A conflicting sale returns **409**. Error bodies are:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "date query parameter is required",
  "requestId": "…"
}
```

## API

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

### GET `/tax-position`

```bash
curl -s 'http://localhost:3000/tax-position?date=2024-01-10T00:00:00Z'
```

After the sale, payment, and amendment above:

| Query `date`           | `taxPosition` (pounds) |
| ---------------------- | ---------------------- |
| `2024-01-01T00:00:00Z` | `2.67`                 |
| `2024-01-10T00:00:00Z` | `2.67`                 |
| `2024-01-15T00:00:00Z` | `1.67`                 |
| `2024-01-20T00:00:00Z` | `1.67`                 |
| `2024-02-01T00:00:00Z` | `-0.13`                |

`2024-01-20` stays `1.67` after the February amendment. The February query is `-0.13` because item A is then 100 pennies at 0.2 (20 pennies of tax), item B remains 67 pennies, and the 100-penny payment is subtracted.

```json
{
  "date": "2024-01-10T00:00:00Z",
  "taxPosition": 2.67
}
```

## Run locally

Node.js 24.15 or newer, Docker, and npm.

```bash
docker compose up -d
cp .env.example .env
npx prisma migrate deploy
npm run start:dev
```

| Variable              | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `PORT`                | HTTP port. Default `3000`. Cloud Run sets `8080`.      |
| `DATABASE_URL`        | Pooled Postgres URL                                    |
| `DIRECT_DATABASE_URL` | Direct URL for migrations. Defaults to `DATABASE_URL`. |
| `LOG_LEVEL`           | Pino level                                             |
| `OTEL_ENABLED`        | `true` exports traces and metrics to Google Cloud      |

Local placeholders:

```env
DATABASE_URL=postgresql://tax:tax@localhost:5432/tax_service?schema=public
DIRECT_DATABASE_URL=postgresql://tax:tax@localhost:5432/tax_service?schema=public
```

`npx prisma migrate reset` drops and recreates the local database. `docker/postgres/init-test-db.sh` creates `tax_service_test` on a fresh Compose volume for integration tests.

| Command                    | Description                        |
| -------------------------- | ---------------------------------- |
| `npm test`                 | Unit and e2e tests. No database.   |
| `npm run test:integration` | Integration tests against Postgres |
| `npm run lint`             | Oxlint                             |
| `npm run format:check`     | Prettier                           |
| `npm run typecheck`        | `tsc --noEmit`                     |
| `npm run build`            | Production build                   |

Do not commit `.env`, database URLs, or service-account keys.

## Deployment

| Item              | Value                                 |
| ----------------- | ------------------------------------- |
| GCP project       | `tax-service-513123` (`338378273837`) |
| Region            | `us-central1`                         |
| Cloud Run service | `tax-service`                         |

Neon is created outside Terraform. Store the pooled URL as a version of Secret Manager secret `database-url`. From `infra/terraform`:

```bash
TF_VAR_github_repository=your-org/tax_service terraform apply
```

`github_repository` has no default. Terraform state is local and gitignored. CI does not apply Terraform.

GitHub Actions variables: `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_REGION`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOYER_SERVICE_ACCOUNT`, `CLOUD_RUN_SERVICE`, `DEPLOY_ENABLED`. Secret `DIRECT_DATABASE_URL` is the Neon direct URL used only by `prisma migrate deploy`. The runtime reads Secret Manager. Deploy authenticates with Workload Identity Federation.

`ci.yml` lints, tests, and builds an image. It does not deploy. `terraform.yml` runs `fmt -check` and `validate`. `deploy.yml` runs on `workflow_dispatch`, and on push to `main` when `DEPLOY_ENABLED` is `true`. It pushes the image tagged with the commit SHA, migrates, updates Cloud Run, and checks `GET /health/ready`.

## Observability

Logs are JSON, with a request id. The service accepts `x-request-id` or generates one. Cost, tax rate, payment amount, and the database URL are not written as log fields. `GET /health/live` does not touch the database. `GET /health/ready` runs `SELECT 1` and returns 503 when the database is unreachable.

With `OTEL_ENABLED=true`, the process exports HTTP and database spans, plus HTTP and ledger metrics, to Google Cloud. The Cloud Monitoring dashboard is **Tax service** in project `tax-service-513123`.

## Infrastructure

Terraform in `infra/terraform/` enables APIs, Artifact Registry, runtime and deployer service accounts, GitHub Workload Identity, the `database-url` secret, and the Cloud Run service. The startup probe is TCP on port 8080. The deploy workflow replaces the container image and then checks `/health/ready`.

```bash
cd infra/terraform
terraform init -backend=false
terraform validate
```
