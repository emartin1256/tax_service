import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { apiErrorResponseSchema } from '../common/swagger/api-error.schema';
import {
  SalesIngestSwaggerDto,
  TaxPaymentIngestSwaggerDto,
} from './dto/swagger/ingest-transaction.swagger';
import { IngestTransactionDto } from './dto/ingest-transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('Transactions')
@ApiExtraModels(SalesIngestSwaggerDto, TaxPaymentIngestSwaggerDto)
@Controller()
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('transactions')
  @HttpCode(202)
  @ApiOperation({ summary: 'Ingest a sales or tax payment event' })
  @ApiBody({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(SalesIngestSwaggerDto) },
        { $ref: getSchemaPath(TaxPaymentIngestSwaggerDto) },
      ],
    },
    examples: {
      sales: {
        summary: 'Sales event',
        value: {
          eventType: 'SALES',
          date: '2024-02-22T17:29:39Z',
          invoiceId: '3419027d-960f-4e8f-b8b7-f7b2b4791824',
          items: [
            {
              itemId: '02db47b6-fe68-4005-a827-24c6e962f3df',
              cost: 1099,
              taxRate: 0.2,
            },
          ],
        },
      },
      taxPayment: {
        summary: 'Tax payment event',
        value: {
          eventType: 'TAX_PAYMENT',
          date: '2024-02-22T17:29:39Z',
          amount: 74901,
        },
      },
    },
  })
  @ApiResponse({ status: 202, description: 'Accepted with no response body' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: apiErrorResponseSchema,
  })
  @ApiResponse({
    status: 409,
    description: 'Conflicting sale item state',
    schema: {
      ...apiErrorResponseSchema,
      example: {
        statusCode: 409,
        error: 'Conflict',
        message:
          'Sale item already exists with different effective date, cost, or tax rate. Use PATCH /sale to amend.',
        requestId: 'unknown',
      },
    },
  })
  async ingest(@Body() body: IngestTransactionDto): Promise<void> {
    await this.transactionsService.ingestTransaction(body);
  }
}
