-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "invoice_id" VARCHAR(128) NOT NULL,
    "item_id" VARCHAR(128) NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "cost_pennies" INTEGER NOT NULL,
    "tax_rate" DECIMAL(18,8) NOT NULL,
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_amendments" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "invoice_id" VARCHAR(128) NOT NULL,
    "item_id" VARCHAR(128) NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "cost_pennies" INTEGER NOT NULL,
    "tax_rate" DECIMAL(18,8) NOT NULL,
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_payments" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "amount_pennies" INTEGER NOT NULL,
    "ingested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_items_effective_at_idx" ON "sale_items"("effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_invoice_id_item_id_key" ON "sale_items"("invoice_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_amendments_sequence_key" ON "sale_amendments"("sequence");

-- CreateIndex
CREATE INDEX "sale_amendments_invoice_id_item_id_effective_at_sequence_idx" ON "sale_amendments"("invoice_id", "item_id", "effective_at", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "tax_payments_sequence_key" ON "tax_payments"("sequence");

-- CreateIndex
CREATE INDEX "tax_payments_effective_at_idx" ON "tax_payments"("effective_at");
