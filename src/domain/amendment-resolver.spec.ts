import {
  type Amendment,
  type SaleLine,
  resolveEffectiveLines,
} from './amendment-resolver';
import { calculateItemTaxPennies } from './money';

const invoiceId = 'inv-1';
const itemId = 'item-1';

function sale(
  effectiveAt: string,
  costPennies: number,
  taxRate = '0.2',
): SaleLine {
  return {
    invoiceId,
    itemId,
    effectiveAt: new Date(effectiveAt),
    costPennies,
    taxRate,
  };
}

function amendment(
  effectiveAt: string,
  ingestedAt: string,
  sequence: bigint,
  costPennies: number,
  taxRate = '0.2',
): Amendment {
  return {
    invoiceId,
    itemId,
    effectiveAt: new Date(effectiveAt),
    ingestedAt: new Date(ingestedAt),
    sequence,
    costPennies,
    taxRate,
  };
}

describe('resolveEffectiveLines', () => {
  it('excludes items before the sale effective time', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-03-01T00:00:00Z', 1000)],
      [],
      new Date('2024-02-01T00:00:00Z'),
    );
    expect(lines).toEqual([]);
  });

  it('includes items at exactly the sale effective time', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-03-01T00:00:00Z', 1000)],
      [],
      new Date('2024-03-01T00:00:00Z'),
    );
    expect(lines).toEqual([
      {
        invoiceId,
        itemId,
        costPennies: 1000,
        taxRate: '0.2',
      },
    ]);
  });

  it('uses the winning amendment by effectiveAt, ingestedAt, then sequence', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-01-01T00:00:00Z', 1000)],
      [
        amendment('2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 1n, 500),
        amendment('2024-03-01T00:00:00Z', '2024-03-02T00:00:00Z', 1n, 100),
      ],
      new Date('2024-03-15T00:00:00Z'),
    );
    expect(lines[0]?.costPennies).toBe(100);
  });

  it('keeps the earlier amendment between two amendment dates', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-01-01T00:00:00Z', 1000)],
      [
        amendment('2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 1n, 500),
        amendment('2024-03-01T00:00:00Z', '2024-03-02T00:00:00Z', 1n, 100),
      ],
      new Date('2024-02-15T00:00:00Z'),
    );
    expect(lines[0]?.costPennies).toBe(500);
  });

  it('lets an amendment with the same effectiveAt as the sale win', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-02-01T00:00:00Z', 1000)],
      [amendment('2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 1n, 100)],
      new Date('2024-02-01T00:00:00Z'),
    );
    expect(lines[0]?.costPennies).toBe(100);
  });

  it('applies a pre-sale amendment once the sale exists at query time', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-03-01T00:00:00Z', 1000)],
      [amendment('2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', 1n, 100)],
      new Date('2024-03-01T00:00:00Z'),
    );
    expect(lines[0]?.costPennies).toBe(100);
  });

  it('does not include amendment-only rows before the sale exists', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-03-01T00:00:00Z', 1000)],
      [amendment('2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', 1n, 100)],
      new Date('2024-02-01T00:00:00Z'),
    );
    expect(lines).toEqual([]);
  });

  it('keeps amendments when the sale is ingested later in time', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-01-01T00:00:00Z', 1000)],
      [amendment('2024-02-01T00:00:00Z', '2024-01-01T00:00:00Z', 1n, 100)],
      new Date('2024-03-01T00:00:00Z'),
    );
    expect(lines[0]?.costPennies).toBe(100);
  });

  it('breaks ties on ingestedAt then sequence', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-01-01T00:00:00Z', 1000)],
      [
        amendment('2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z', 1n, 200),
        amendment('2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 1n, 100),
        amendment('2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 2n, 50),
      ],
      new Date('2024-03-01T00:00:00Z'),
    );
    expect(lines[0]?.costPennies).toBe(50);
  });

  it('replaces the sale tax rate with the winning amendment rate', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-01-01T00:00:00Z', 1000, '0.2')],
      [
        amendment(
          '2024-02-01T00:00:00Z',
          '2024-02-02T00:00:00Z',
          1n,
          798,
          '0.15',
        ),
      ],
      new Date('2024-03-01T00:00:00Z'),
    );
    const line = lines[0];
    expect(line?.taxRate).toBe('0.15');
    expect(line?.costPennies).toBe(798);
    expect(calculateItemTaxPennies(line!.costPennies, line!.taxRate)).toBe(120);
    expect(calculateItemTaxPennies(798, '0.2')).toBe(160);
  });

  it('prefers later ingestedAt over higher sequence when effectiveAt matches', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-01-01T00:00:00Z', 1000)],
      [
        amendment('2024-02-01T00:00:00Z', '2024-02-03T00:00:00Z', 1n, 111),
        amendment('2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 99n, 222),
      ],
      new Date('2024-03-01T00:00:00Z'),
    );
    expect(lines[0]?.costPennies).toBe(111);
  });

  it('prefers higher sequence when effectiveAt and ingestedAt match', () => {
    const lines = resolveEffectiveLines(
      [sale('2024-01-01T00:00:00Z', 1000)],
      [
        amendment('2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 1n, 300),
        amendment('2024-02-01T00:00:00Z', '2024-02-02T00:00:00Z', 2n, 400),
      ],
      new Date('2024-03-01T00:00:00Z'),
    );
    expect(lines[0]?.costPennies).toBe(400);
  });
});
