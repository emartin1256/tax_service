import { Module } from '@nestjs/common';
import { SaleAmendmentRepository } from '../database/sale-amendment.repository';
import { SaleItemRepository } from '../database/sale-item.repository';
import { TaxPaymentRepository } from '../database/tax-payment.repository';
import { TaxPositionModule } from '../tax-position/tax-position.module';
import { SaleController } from './sale.controller';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [TaxPositionModule],
  controllers: [TransactionsController, SaleController],
  providers: [
    TransactionsService,
    SaleItemRepository,
    SaleAmendmentRepository,
    TaxPaymentRepository,
  ],
})
export class TransactionsModule {}
