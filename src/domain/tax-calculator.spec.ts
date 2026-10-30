import { resolveEffectiveLines } from './amendment-resolver';
import {
  calculateTaxPositionPennies,
  calculateTaxPositionPounds,
} from './tax-calculator';

const invoiceId = 'inv-1';
const itemA = 'item-a';
const itemB = 'item-b';

describe('tax-calculator', () => {
  const baseSales = [
    {
      invoiceId,
      itemId: itemA,
      effectiveAt: new Date('2024-01-01T00:00:00Z'),
      costPennies: 1000,
      taxRate: '0.2',
    },
    {
      invoiceId,
      itemId: itemB,
      effectiveAt: new Date('2024-01-01T00:00:00Z'),
      costPennies: 333,
      taxRate: '0.2',
    },
  ];

  it('computes total tax minus payments in pennies and pounds', () => {
    const lines = resolveEffectiveLines(
      baseSales,
      [],
      new Date('2024-06-01T00:00:00Z'),
    );
    expect(calculateTaxPositionPennies(lines, [])).toBe(267);
    expect(calculateTaxPositionPounds(lines, [])).toBe(2.67);

    expect(calculateTaxPositionPennies(lines, [100])).toBe(167);
    expect(calculateTaxPositionPounds(lines, [100])).toBe(1.67);
  });

  it('reflects amendments at query time', () => {
    const at = new Date('2024-06-01T00:00:00Z');
    const beforeAmendment = resolveEffectiveLines(baseSales, [], at);
    expect(calculateTaxPositionPounds(beforeAmendment, [100])).toBe(1.67);

    const afterAmendment = resolveEffectiveLines(
      baseSales,
      [
        {
          invoiceId,
          itemId: itemA,
          effectiveAt: new Date('2024-03-01T00:00:00Z'),
          ingestedAt: new Date('2024-03-02T00:00:00Z'),
          sequence: 1n,
          costPennies: 100,
          taxRate: '0.2',
        },
      ],
      at,
    );
    expect(calculateTaxPositionPennies(afterAmendment, [100])).toBe(-13);
    expect(calculateTaxPositionPounds(afterAmendment, [100])).toBe(-0.13);
  });

  it('uses amendment values at sale time when amendment predates the sale', () => {
    const saleInstant = new Date('2024-03-01T00:00:00Z');
    const beforeSale = resolveEffectiveLines(
      [
        {
          invoiceId,
          itemId: itemA,
          effectiveAt: saleInstant,
          costPennies: 1000,
          taxRate: '0.2',
        },
      ],
      [
        {
          invoiceId,
          itemId: itemA,
          effectiveAt: new Date('2024-01-01T00:00:00Z'),
          ingestedAt: new Date('2024-01-02T00:00:00Z'),
          sequence: 1n,
          costPennies: 100,
          taxRate: '0.2',
        },
      ],
      new Date('2024-02-01T00:00:00Z'),
    );
    expect(calculateTaxPositionPennies(beforeSale, [])).toBe(0);

    const atSale = resolveEffectiveLines(
      [
        {
          invoiceId,
          itemId: itemA,
          effectiveAt: saleInstant,
          costPennies: 1000,
          taxRate: '0.2',
        },
      ],
      [
        {
          invoiceId,
          itemId: itemA,
          effectiveAt: new Date('2024-01-01T00:00:00Z'),
          ingestedAt: new Date('2024-01-02T00:00:00Z'),
          sequence: 1n,
          costPennies: 100,
          taxRate: '0.2',
        },
      ],
      saleInstant,
    );
    expect(calculateTaxPositionPennies(atSale, [])).toBe(20);
  });
});
