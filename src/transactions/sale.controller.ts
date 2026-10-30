import { Body, Controller, HttpCode, Patch } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { apiErrorResponseSchema } from '../common/swagger/api-error.schema';
import { AmendSaleDto } from './dto/amend-sale.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('Sales')
@Controller()
export class SaleController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Patch('sale')
  @HttpCode(202)
  @ApiOperation({ summary: 'Amend a sale line on an invoice' })
  @ApiBody({ type: AmendSaleDto })
  @ApiResponse({ status: 202, description: 'Accepted with no response body' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: apiErrorResponseSchema,
  })
  async amend(@Body() body: AmendSaleDto): Promise<void> {
    await this.transactionsService.amendSale(body);
  }
}
