import type { NodeSDK } from '@opentelemetry/sdk-node';

let activeSdk: NodeSDK | undefined;

function warn(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? error.message : error ? String(error) : '';
  console.warn(detail ? `${message}: ${detail}` : message);
}

export async function initializeTracing(enabled: boolean): Promise<void> {
  if (!enabled || activeSdk) {
    return;
  }

  try {
    const [{ NodeSDK }, { HttpInstrumentation }, { PgInstrumentation }] =
      await Promise.all([
        import('@opentelemetry/sdk-node'),
        import('@opentelemetry/instrumentation-http'),
        import('@opentelemetry/instrumentation-pg'),
      ]);

    let traceExporter;

    try {
      const { TraceExporter } =
        await import('@google-cloud/opentelemetry-cloud-trace-exporter');
      traceExporter = new TraceExporter();
    } catch (error) {
      warn(
        'OpenTelemetry: Cloud Trace exporter unavailable; continuing without export',
        error,
      );
      return;
    }

    const sdk = new NodeSDK({
      traceExporter,
      instrumentations: [new HttpInstrumentation(), new PgInstrumentation()],
    });

    sdk.start();
    activeSdk = sdk;
  } catch (error) {
    warn('OpenTelemetry failed to start; continuing without tracing', error);
    activeSdk = undefined;
  }
}

export async function shutdownTracing(): Promise<void> {
  const sdk = activeSdk;
  activeSdk = undefined;
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } catch (error) {
    warn('OpenTelemetry shutdown failed', error);
  }
}
