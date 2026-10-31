import { Injectable } from '@nestjs/common';
import {
  metrics,
  type Counter,
  type Gauge,
  type Histogram,
  type Meter,
} from '@opentelemetry/api';

const METER_NAME = 'tax-service';
const HORIZON_RECENT_MS = 24 * 60 * 60 * 1000;

export type TaxPositionQueryHorizon = 'future' | 'recent' | 'past';

export type FutureDatedEvent = 'sale' | 'payment' | 'amendment';

export type TaxPositionSign = 'positive' | 'zero' | 'negative';

export function classifyTaxPositionQueryHorizon(
  at: Date,
  now: Date,
): TaxPositionQueryHorizon {
  const atMs = at.getTime();
  const nowMs = now.getTime();
  if (atMs > nowMs) {
    return 'future';
  }
  if (nowMs - atMs <= HORIZON_RECENT_MS) {
    return 'recent';
  }
  return 'past';
}

function taxPositionSign(pennies: number): TaxPositionSign {
  if (pennies > 0) {
    return 'positive';
  }
  if (pennies < 0) {
    return 'negative';
  }
  return 'zero';
}

@Injectable()
export class LedgerMetrics {
  private static testMeter: Meter | undefined;

  /** @internal tests only */
  static useTestMeter(meter: Meter | undefined): void {
    LedgerMetrics.testMeter = meter;
  }

  private saleLinesCounter: Counter | undefined;
  private saleLinesConflictCounter: Counter | undefined;
  private recognizedPenniesCounter: Counter | undefined;
  private paymentEventsCounter: Counter | undefined;
  private paymentPenniesCounter: Counter | undefined;
  private amendmentsCounter: Counter | undefined;
  private futureDatedEventsCounter: Counter | undefined;
  private positionNowGauge: Gauge | undefined;
  private positionQueriesCounter: Counter | undefined;
  private positionResultHistogram: Histogram | undefined;
  private positionLinesHistogram: Histogram | undefined;

  private get meter() {
    return LedgerMetrics.testMeter ?? metrics.getMeter(METER_NAME);
  }

  recordSaleLines(created: number, identicalReplay: number): void {
    if (created > 0) {
      this.saleLines().add(created, { outcome: 'created' });
    }
    if (identicalReplay > 0) {
      this.saleLines().add(identicalReplay, { outcome: 'identical_replay' });
    }
  }

  recordSaleLineConflict(): void {
    this.saleLinesConflict().add(1);
  }

  recordRecognizedTaxPennies(pennies: number): void {
    if (pennies !== 0) {
      this.recognizedPennies().add(pennies);
    }
  }

  recordPayment(): void {
    this.paymentEvents().add(1);
  }

  recordPaymentPennies(pennies: number): void {
    this.paymentPennies().add(pennies);
  }

  recordAmendment(salePresent: boolean): void {
    this.amendments().add(1, { sale_present: salePresent ? 'true' : 'false' });
  }

  recordFutureDatedEvent(event: FutureDatedEvent): void {
    this.futureDatedEvents().add(1, { event });
  }

  recordPositionNowGauge(pennies: number): void {
    this.positionNow().record(pennies);
  }

  recordTaxPositionQuery(horizon: TaxPositionQueryHorizon): void {
    this.positionQueries().add(1, { horizon });
  }

  recordTaxPositionResult(pennies: number): void {
    this.positionResult().record(Math.abs(pennies), {
      sign: taxPositionSign(pennies),
    });
  }

  recordTaxPositionLines(lineCount: number): void {
    this.positionLines().record(lineCount);
  }

  private saleLines(): Counter {
    if (!this.saleLinesCounter) {
      this.saleLinesCounter = this.meter.createCounter('tax_sale_lines');
    }
    return this.saleLinesCounter;
  }

  private saleLinesConflict(): Counter {
    if (!this.saleLinesConflictCounter) {
      this.saleLinesConflictCounter = this.meter.createCounter(
        'tax_sale_lines_conflict',
      );
    }
    return this.saleLinesConflictCounter;
  }

  private recognizedPennies(): Counter {
    if (!this.recognizedPenniesCounter) {
      this.recognizedPenniesCounter = this.meter.createCounter(
        'tax_recognized_pennies',
      );
    }
    return this.recognizedPenniesCounter;
  }

  private paymentEvents(): Counter {
    if (!this.paymentEventsCounter) {
      this.paymentEventsCounter =
        this.meter.createCounter('tax_payment_events');
    }
    return this.paymentEventsCounter;
  }

  private paymentPennies(): Counter {
    if (!this.paymentPenniesCounter) {
      this.paymentPenniesCounter = this.meter.createCounter(
        'tax_payment_pennies',
      );
    }
    return this.paymentPenniesCounter;
  }

  private amendments(): Counter {
    if (!this.amendmentsCounter) {
      this.amendmentsCounter = this.meter.createCounter('tax_amendments');
    }
    return this.amendmentsCounter;
  }

  private futureDatedEvents(): Counter {
    if (!this.futureDatedEventsCounter) {
      this.futureDatedEventsCounter = this.meter.createCounter(
        'tax_events_future_dated',
      );
    }
    return this.futureDatedEventsCounter;
  }

  private positionNow(): Gauge {
    if (!this.positionNowGauge) {
      this.positionNowGauge = this.meter.createGauge(
        'tax_position_now_pennies',
      );
    }
    return this.positionNowGauge;
  }

  private positionQueries(): Counter {
    if (!this.positionQueriesCounter) {
      this.positionQueriesCounter = this.meter.createCounter(
        'tax_position_queries',
      );
    }
    return this.positionQueriesCounter;
  }

  private positionResult(): Histogram {
    if (!this.positionResultHistogram) {
      this.positionResultHistogram = this.meter.createHistogram(
        'tax_position_result_pennies',
      );
    }
    return this.positionResultHistogram;
  }

  private positionLines(): Histogram {
    if (!this.positionLinesHistogram) {
      this.positionLinesHistogram =
        this.meter.createHistogram('tax_position_lines');
    }
    return this.positionLinesHistogram;
  }
}
