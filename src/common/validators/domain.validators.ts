import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { isValidInstantTimestamp } from '../../domain/dates';
import { isValidMoneyAmountPennies, isValidTaxRate } from '../../domain/money';

@ValidatorConstraint({ name: 'isValidInstantTimestamp', async: false })
export class IsValidInstantTimestampConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidInstantTimestamp(value);
  }

  defaultMessage(): string {
    return 'date must be a valid ISO 8601 instant with timezone';
  }
}

@ValidatorConstraint({ name: 'isNonBlankString', async: false })
export class IsNonBlankStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const maxLength = (args.constraints[0] as number | undefined) ?? 128;
    return (
      value.length > 0 && value.length <= maxLength && value.trim().length > 0
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const property = args.property;
    return `${property} must be a non-empty string with at most 128 characters`;
  }
}

export function IsNonBlankString(
  maxLength = 128,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [maxLength],
      validator: IsNonBlankStringConstraint,
    });
  };
}

@ValidatorConstraint({ name: 'isMoneyPenniesInteger', async: false })
export class IsMoneyPenniesIntegerConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidMoneyAmountPennies(value);
  }

  defaultMessage(): string {
    return 'value must be a JSON integer amount in pennies';
  }
}

@ValidatorConstraint({ name: 'isValidTaxRateNumber', async: false })
export class IsValidTaxRateNumberConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidTaxRate(value);
  }

  defaultMessage(): string {
    return 'taxRate must be a non-negative number with at most 8 decimal places';
  }
}
