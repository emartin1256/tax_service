import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiErrorResponseSchema } from '../common/swagger/api-error.schema';
import { TaxPositionResponseDto } from './dto/tax-position-response.dto';
import { TaxPositionService } from './tax-position.service';

@ApiTags('Tax position')
@Controller()
export class TaxPositionController {
  constructor(private readonly taxPositionService: TaxPositionService) {}

  @Get('tax-position')
  @ApiOperation({ summary: 'Query tax position at an instant' })
  @ApiQuery({
    name: 'date',
    required: true,
    description: 'ISO 8601 instant with timezone',
    example: '2024-02-22T17:29:39Z',
  })
  @ApiResponse({ status: 200, type: TaxPositionResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Invalid or missing date',
    schema: apiErrorResponseSchema,
  })
  getTaxPosition(
    @Query('date') date: string | undefined,
  ): Promise<TaxPositionResponseDto> {
    return this.taxPositionService.getTaxPosition(date);
  }
}
