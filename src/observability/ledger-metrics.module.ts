import { Global, Module } from '@nestjs/common';
import { LedgerMetrics } from './ledger-metrics';

@Global()
@Module({
  providers: [LedgerMetrics],
  exports: [LedgerMetrics],
})
export class LedgerMetricsModule {}
