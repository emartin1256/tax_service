import { ApiProperty } from '@nestjs/swagger';

export class SaleItemSwaggerDto {
  @ApiProperty({ example: '02db47b6-fe68-4005-a827-24c6e962f3df' })
  itemId!: string;

  @ApiProperty({
    description: 'Cost in pennies',
    example: 1099,
  })
  cost!: number;

  @ApiProperty({ example: 0.2 })
  taxRate!: number;
}

export class SalesIngestSwaggerDto {
  @ApiProperty({ enum: ['SALES'] })
  eventType!: 'SALES';

  @ApiProperty({
    description: 'ISO 8601 instant with timezone',
    example: '2024-02-22T17:29:39Z',
  })
  date!: string;

  @ApiProperty({ example: '3419027d-960f-4e8f-b8b7-f7b2b4791824' })
  invoiceId!: string;

  @ApiProperty({ type: [SaleItemSwaggerDto] })
  items!: SaleItemSwaggerDto[];
}

export class TaxPaymentIngestSwaggerDto {
  @ApiProperty({ enum: ['TAX_PAYMENT'] })
  eventType!: 'TAX_PAYMENT';

  @ApiProperty({
    description: 'ISO 8601 instant with timezone',
    example: '2024-02-22T17:29:39Z',
  })
  date!: string;

  @ApiProperty({
    description: 'Payment amount in pennies',
    example: 74901,
  })
  amount!: number;
}
