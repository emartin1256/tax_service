import { ApiProperty } from '@nestjs/swagger';

export class TaxPositionResponseDto {
  @ApiProperty({
    description: 'Query instant in ISO 8601 UTC',
    example: '2024-02-22T17:29:39Z',
  })
  date!: string;

  @ApiProperty({
    description: 'Tax position in pounds',
    example: 0.49,
  })
  taxPosition!: number;
}
