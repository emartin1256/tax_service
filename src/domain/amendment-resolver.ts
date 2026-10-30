export type SaleLine = {
  invoiceId: string;
  itemId: string;
  effectiveAt: Date;
  costPennies: number;
  taxRate: string;
};

export type Amendment = SaleLine & {
  sequence: bigint;
  ingestedAt: Date;
};

export type EffectiveLine = {
  invoiceId: string;
  itemId: string;
  costPennies: number;
  taxRate: string;
};

function itemKey(invoiceId: string, itemId: string): string {
  return `${invoiceId}\0${itemId}`;
}

function compareAmendments(a: Amendment, b: Amendment): number {
  const effectiveDiff = a.effectiveAt.getTime() - b.effectiveAt.getTime();
  if (effectiveDiff !== 0) {
    return effectiveDiff;
  }
  const ingestedDiff = a.ingestedAt.getTime() - b.ingestedAt.getTime();
  if (ingestedDiff !== 0) {
    return ingestedDiff;
  }
  if (a.sequence === b.sequence) {
    return 0;
  }
  return a.sequence > b.sequence ? 1 : -1;
}

function pickWinningAmendment(
  amendments: Amendment[],
  at: Date,
): Amendment | undefined {
  const eligible = amendments.filter(
    (amendment) => amendment.effectiveAt.getTime() <= at.getTime(),
  );
  if (eligible.length === 0) {
    return undefined;
  }
  return eligible.reduce((best, current) =>
    compareAmendments(current, best) > 0 ? current : best,
  );
}

function pickActiveSale(sales: SaleLine[], at: Date): SaleLine | undefined {
  const eligible = sales.filter(
    (sale) => sale.effectiveAt.getTime() <= at.getTime(),
  );
  if (eligible.length === 0) {
    return undefined;
  }
  return eligible.reduce((best, current) =>
    current.effectiveAt.getTime() > best.effectiveAt.getTime() ? current : best,
  );
}

export function resolveEffectiveLines(
  sales: SaleLine[],
  amendments: Amendment[],
  at: Date,
): EffectiveLine[] {
  const salesByKey = new Map<string, SaleLine[]>();
  for (const sale of sales) {
    const key = itemKey(sale.invoiceId, sale.itemId);
    const group = salesByKey.get(key);
    if (group) {
      group.push(sale);
    } else {
      salesByKey.set(key, [sale]);
    }
  }

  const amendmentsByKey = new Map<string, Amendment[]>();
  for (const amendment of amendments) {
    const key = itemKey(amendment.invoiceId, amendment.itemId);
    const group = amendmentsByKey.get(key);
    if (group) {
      group.push(amendment);
    } else {
      amendmentsByKey.set(key, [amendment]);
    }
  }

  const keys = new Set<string>([
    ...salesByKey.keys(),
    ...amendmentsByKey.keys(),
  ]);

  const result: EffectiveLine[] = [];

  for (const key of keys) {
    const sale = pickActiveSale(salesByKey.get(key) ?? [], at);
    if (!sale) {
      continue;
    }

    const winningAmendment = pickWinningAmendment(
      amendmentsByKey.get(key) ?? [],
      at,
    );

    if (winningAmendment) {
      result.push({
        invoiceId: sale.invoiceId,
        itemId: sale.itemId,
        costPennies: winningAmendment.costPennies,
        taxRate: winningAmendment.taxRate,
      });
    } else {
      result.push({
        invoiceId: sale.invoiceId,
        itemId: sale.itemId,
        costPennies: sale.costPennies,
        taxRate: sale.taxRate,
      });
    }
  }

  return result;
}
