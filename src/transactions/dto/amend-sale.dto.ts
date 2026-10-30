import { ApiProperty } from '@nestjs/swagger';
import { Validate } from 'class-validator';
import {
  IsMoneyPenniesIntegerConstraint,
  IsNonBlankString,
  IsValidInstantTimestampConstraint,
  IsValidTaxRateNumberConstraint,
} from '../../common/validators/domain.validators';

export class AmendSaleDto {
  @ApiProperty({
    description: 'ISO 8601 instant with timezone',
    example: '2024-02-22T17:29:39Z',
  })
  @Validate(IsValidInstantTimestampConstraint)
  date!: string;

  @ApiProperty({ example: '3419027d-960f-4e8f-b8b7-f7b2b4791824' })
  @IsNonBlankString()
  invoiceId!: string;

  @ApiProperty({ example: '02db47b6-fe68-4005-a827-24c6e962f3df' })
  @IsNonBlankString()
  itemId!: string;

  @ApiProperty({ description: 'Cost in pennies', example: 1099 })
  @Validate(IsMoneyPenniesIntegerConstraint)
  cost!: number;

  @ApiProperty({ example: 0.2 })
  @Validate(IsValidTaxRateNumberConstraint)
  taxRate!: number;
}
