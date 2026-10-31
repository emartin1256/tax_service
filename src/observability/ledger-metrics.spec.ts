import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type MetricData,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';

jest.mock('@nestjs/common', () => ({
  Injectable: () => (target: unknown) => target,
}));

import {
  classifyTaxPositionQueryHorizon,
  LedgerMetrics,
} from './ledger-metrics';

function findMetric(
  resourceMetrics: ResourceMetrics[],
  name: string,
): MetricData | undefined {
  for (const batch of resourceMetrics) {
    for (const scope of batch.scopeMetrics) {
      const metric = scope.metrics.find((m) => m.descriptor.name === name);
      if (metric) {
        return metric;
      }
    }
  }
  return undefined;
}

function sumCounter(
  resourceMetrics: ResourceMetrics[],
  name: string,
  attributes?: Record<string, string>,
): number {
  const metric = findMetric(resourceMetrics, name);
  if (!metric || metric.dataPointType !== DataPointType.SUM) {
    return 0;
  }
  return metric.dataPoints
    .filter((point) => {
      if (!attributes) {
        return true;
      }
      return Object.entries(attributes).every(
        ([key, value]) => point.attributes[key] === value,
      );
    })
    .reduce((total, point) => total + point.value, 0);
}

function lastGaugeValue(
  resourceMetrics: ResourceMetrics[],
  name: string,
): number | undefined {
  const metric = findMetric(resourceMetrics, name);
  if (!metric || metric.dataPointType !== DataPointType.GAUGE) {
    return undefined;
  }
  const last = metric.dataPoints.at(-1);
  return last?.value;
}

function histogramPoints(
  resourceMetrics: ResourceMetrics[],
  name: string,
  attributes?: Record<string, string>,
) {
  const metric = findMetric(resourceMetrics, name);
  if (!metric || metric.dataPointType !== DataPointType.HISTOGRAM) {
    return [];
  }
  return metric.dataPoints.filter((point) => {
    if (!attributes) {
      return true;
    }
    return Object.entries(attributes).every(
      ([key, value]) => point.attributes[key] === value,
    );
  });
}

describe('LedgerMetrics', () => {
  let provider: MeterProvider;
  let exporter: InMemoryMetricExporter;
  let ledgerMetrics: LedgerMetrics;

  beforeEach(async () => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    provider = new MeterProvider({ readers: [reader] });
    const meter = provider.getMeter('tax-service');
    LedgerMetrics.useTestMeter(meter);
    ledgerMetrics = new LedgerMetrics();
  });

  afterEach(async () => {
    LedgerMetrics.useTestMeter(undefined);
    await provider.shutdown();
  });

  async function flushMetrics(): Promise<ResourceMetrics[]> {
    await provider.forceFlush();
    return exporter.getMetrics();
  }

  it('records sale line counters and recognized pennies', async () => {
    ledgerMetrics.recordSaleLines(2, 1);
    ledgerMetrics.recordRecognizedTaxPennies(220);

    const batches = await flushMetrics();
    expect(sumCounter(batches, 'tax_sale_lines', { outcome: 'created' })).toBe(
      2,
    );
    expect(
      sumCounter(batches, 'tax_sale_lines', { outcome: 'identical_replay' }),
    ).toBe(1);
    expect(sumCounter(batches, 'tax_recognized_pennies')).toBe(220);
  });

  it('does not add recognized pennies when only recording a conflict', async () => {
    ledgerMetrics.recordSaleLineConflict();

    const batches = await flushMetrics();
    expect(sumCounter(batches, 'tax_sale_lines_conflict')).toBe(1);
    expect(sumCounter(batches, 'tax_recognized_pennies')).toBe(0);
  });

  it('records payment pennies', async () => {
    ledgerMetrics.recordPayment();
    ledgerMetrics.recordPaymentPennies(74901);

    const batches = await flushMetrics();
    expect(sumCounter(batches, 'tax_payment_events')).toBe(1);
    expect(sumCounter(batches, 'tax_payment_pennies')).toBe(74901);
  });

  it('records a negative position on the gauge', async () => {
    ledgerMetrics.recordPositionNowGauge(-13);

    const batches = await flushMetrics();
    expect(lastGaugeValue(batches, 'tax_position_now_pennies')).toBe(-13);
  });

  it('stores negative tax position histogram observations as absolute value with sign=negative', async () => {
    ledgerMetrics.recordTaxPositionResult(-13);

    const batches = await flushMetrics();
    const points = histogramPoints(batches, 'tax_position_result_pennies', {
      sign: 'negative',
    });
    expect(points).toHaveLength(1);
    expect(points[0]?.value.sum).toBe(13);
    expect(points[0]?.value.count).toBe(1);
  });

  describe('classifyTaxPositionQueryHorizon', () => {
    const now = new Date('2024-06-15T12:00:00.000Z');

    it('classifies one hour ago as recent', () => {
      const at = new Date(now.getTime() - 60 * 60 * 1000);
      expect(classifyTaxPositionQueryHorizon(at, now)).toBe('recent');
    });

    it('classifies three days ago as past', () => {
      const at = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      expect(classifyTaxPositionQueryHorizon(at, now)).toBe('past');
    });

    it('classifies one hour ahead as future', () => {
      const at = new Date(now.getTime() + 60 * 60 * 1000);
      expect(classifyTaxPositionQueryHorizon(at, now)).toBe('future');
    });
  });

  it('records tax position query horizons via metrics', async () => {
    const now = new Date('2024-06-15T12:00:00.000Z');
    ledgerMetrics.recordTaxPositionQuery(
      classifyTaxPositionQueryHorizon(
        new Date(now.getTime() - 60 * 60 * 1000),
        now,
      ),
    );
    ledgerMetrics.recordTaxPositionQuery(
      classifyTaxPositionQueryHorizon(
        new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        now,
      ),
    );
    ledgerMetrics.recordTaxPositionQuery(
      classifyTaxPositionQueryHorizon(
        new Date(now.getTime() + 60 * 60 * 1000),
        now,
      ),
    );

    const batches = await flushMetrics();
    expect(
      sumCounter(batches, 'tax_position_queries', { horizon: 'recent' }),
    ).toBe(1);
    expect(
      sumCounter(batches, 'tax_position_queries', { horizon: 'past' }),
    ).toBe(1);
    expect(
      sumCounter(batches, 'tax_position_queries', { horizon: 'future' }),
    ).toBe(1);
  });
});
