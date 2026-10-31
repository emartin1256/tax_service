import { Module } from '@nestjs/common';
import { SaleAmendmentRepository } from '../database/sale-amendment.repository';
import { SaleItemRepository } from '../database/sale-item.repository';
import { TaxPaymentRepository } from '../database/tax-payment.repository';
import { TaxPositionController } from './tax-position.controller';
import { TaxPositionService } from './tax-position.service';

@Module({
  controllers: [TaxPositionController],
  providers: [
    TaxPositionService,
    SaleItemRepository,
    SaleAmendmentRepository,
    TaxPaymentRepository,
  ],
  exports: [TaxPositionService],
})
export class TaxPositionModule {}
