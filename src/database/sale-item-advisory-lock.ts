import { createHash } from 'node:crypto';

export function saleItemAdvisoryLockKeys(
  invoiceId: string,
  itemId: string,
): [number, number] {
  const hash = createHash('sha256')
    .update(invoiceId)
    .update('\0')
    .update(itemId)
    .digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}
