import {
  Allow,
  IsIn,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  IsMoneyPenniesIntegerConstraint,
  IsNonBlankStringConstraint,
  IsValidInstantTimestampConstraint,
  IsValidTaxRateNumberConstraint,
} from '../../common/validators/domain.validators';

const MAX_ITEMS = 500;

const instantValidator = new IsValidInstantTimestampConstraint();
const moneyValidator = new IsMoneyPenniesIntegerConstraint();
const taxRateValidator = new IsValidTaxRateNumberConstraint();
const nonBlankValidator = new IsNonBlankStringConstraint();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateNonBlankString(value: unknown): boolean {
  return nonBlankValidator.validate(value, {
    constraints: [128],
  } as ValidationArguments);
}

function validateSaleItem(item: unknown, index: number): string | null {
  if (!isPlainObject(item)) {
    return `items[${index}] must be an object`;
  }
  const allowedKeys = new Set(['itemId', 'cost', 'taxRate']);
  for (const key of Object.keys(item)) {
    if (!allowedKeys.has(key)) {
      return `items[${index}] must not contain unknown property ${key}`;
    }
  }
  if (!validateNonBlankString(item.itemId)) {
    return `items[${index}].itemId must be a non-empty string with at most 128 characters`;
  }
  if (!moneyValidator.validate(item.cost)) {
    return `items[${index}].cost must be a JSON integer amount in pennies`;
  }
  if (!taxRateValidator.validate(item.taxRate)) {
    return `items[${index}].taxRate must be a non-negative number with at most 8 decimal places`;
  }
  return null;
}

@ValidatorConstraint({ name: 'ingestTransactionShape', async: false })
export class IngestTransactionShapeConstraint implements ValidatorConstraintInterface {
  private lastMessage = 'Invalid transaction payload';

  validate(_value: unknown, args: ValidationArguments): boolean {
    const body = args.object as Record<string, unknown>;
    const eventType = body.eventType;

    if (eventType === 'SALES') {
      return this.validateSales(body);
    }
    if (eventType === 'TAX_PAYMENT') {
      return this.validateTaxPayment(body);
    }
    this.lastMessage = 'eventType must be SALES or TAX_PAYMENT';
    return false;
  }

  defaultMessage(): string {
    return this.lastMessage;
  }

  private validateSales(body: Record<string, unknown>): boolean {
    if (body.amount !== undefined) {
      this.lastMessage = 'amount must not be present for SALES events';
      return false;
    }
    if (!instantValidator.validate(body.date)) {
      this.lastMessage = 'date must be a valid ISO 8601 instant with timezone';
      return false;
    }
    if (!validateNonBlankString(body.invoiceId)) {
      this.lastMessage =
        'invoiceId must be a non-empty string with at most 128 characters';
      return false;
    }
    if (!Array.isArray(body.items)) {
      this.lastMessage = 'items must be an array';
      return false;
    }
    if (body.items.length === 0) {
      this.lastMessage = 'items must contain at least one element';
      return false;
    }
    if (body.items.length > MAX_ITEMS) {
      this.lastMessage = `items must contain at most ${MAX_ITEMS} elements`;
      return false;
    }
    const seenItemIds = new Set<string>();
    for (let index = 0; index < body.items.length; index += 1) {
      const itemError = validateSaleItem(body.items[index], index);
      if (itemError) {
        this.lastMessage = itemError;
        return false;
      }
      const item = body.items[index] as Record<string, unknown>;
      const itemId = item.itemId as string;
      if (seenItemIds.has(itemId)) {
        this.lastMessage = 'items must not contain duplicate itemId values';
        return false;
      }
      seenItemIds.add(itemId);
    }
    return true;
  }

  private validateTaxPayment(body: Record<string, unknown>): boolean {
    if (body.invoiceId !== undefined) {
      this.lastMessage = 'invoiceId must not be present for TAX_PAYMENT events';
      return false;
    }
    if (body.items !== undefined) {
      this.lastMessage = 'items must not be present for TAX_PAYMENT events';
      return false;
    }
    if (!instantValidator.validate(body.date)) {
      this.lastMessage = 'date must be a valid ISO 8601 instant with timezone';
      return false;
    }
    if (!moneyValidator.validate(body.amount)) {
      this.lastMessage = 'amount must be a JSON integer amount in pennies';
      return false;
    }
    return true;
  }
}

export class IngestTransactionDto {
  @Validate(IngestTransactionShapeConstraint)
  @IsIn(['SALES', 'TAX_PAYMENT'])
  eventType!: 'SALES' | 'TAX_PAYMENT';

  @Allow()
  date?: string;

  @Allow()
  invoiceId?: string;

  @Allow()
  items?: Array<{
    itemId: string;
    cost: number;
    taxRate: number;
  }>;

  @Allow()
  amount?: number;
}

export type SalesIngestPayload = {
  eventType: 'SALES';
  date: string;
  invoiceId: string;
  items: Array<{
    itemId: string;
    cost: number;
    taxRate: number;
  }>;
};

export type TaxPaymentIngestPayload = {
  eventType: 'TAX_PAYMENT';
  date: string;
  amount: number;
};

export function asSalesIngestPayload(
  dto: IngestTransactionDto,
): SalesIngestPayload {
  return dto as SalesIngestPayload;
}

export function asTaxPaymentIngestPayload(
  dto: IngestTransactionDto,
): TaxPaymentIngestPayload {
  return dto as TaxPaymentIngestPayload;
}
