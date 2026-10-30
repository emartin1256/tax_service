import type { GoogleAuth } from 'google-auth-library';
import type { NodeSDK } from '@opentelemetry/sdk-node';

let activeSdk: NodeSDK | undefined;
let cachedGoogleAuth: GoogleAuth | undefined;
let cachedAuthHeaders: (() => Promise<Record<string, string>>) | undefined;

const GCP_CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const OTLP_TRACES_URL = 'https://telemetry.googleapis.com/v1/traces';
const OTLP_METRICS_URL = 'https://telemetry.googleapis.com/v1/metrics';
const METRIC_EXPORT_INTERVAL_MS = 30_000;

export function isSafeToLogOpenTelemetryMessage(message: string): boolean {
  return !message.includes('Bearer') && !message.includes('ya29.');
}

const GCP_PROJECT_ID_UNAVAILABLE_MARKER = 'Unable to detect a Project Id';

export function isGcpProjectIdUnavailableError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : error ? String(error) : '';
  return message.includes(GCP_PROJECT_ID_UNAVAILABLE_MARKER);
}

async function resolveGcpProjectId(
  auth: GoogleAuth,
): Promise<string | undefined> {
  try {
    const projectId = await auth.getProjectId();
    return projectId || undefined;
  } catch (error) {
    if (isGcpProjectIdUnavailableError(error)) {
      return undefined;
    }
    throw error;
  }
}

function warn(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? error.message : error ? String(error) : '';
  if (detail && isSafeToLogOpenTelemetryMessage(detail)) {
    console.warn(`${message}: ${detail}`);
    return;
  }
  console.warn(message);
}

async function getGoogleAuth(): Promise<GoogleAuth> {
  if (!cachedGoogleAuth) {
    const { GoogleAuth: GoogleAuthCtor } = await import('google-auth-library');
    cachedGoogleAuth = new GoogleAuthCtor({
      scopes: [GCP_CLOUD_PLATFORM_SCOPE],
    });
  }
  return cachedGoogleAuth;
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  if (!cachedAuthHeaders) {
    const auth = await getGoogleAuth();
    const client = await auth.getClient();
    cachedAuthHeaders = async () => {
      const accessToken = await client.getAccessToken();
      const token =
        typeof accessToken === 'string' ? accessToken : accessToken?.token;
      if (!token) {
        throw new Error('OpenTelemetry: GCP access token unavailable');
      }
      return { Authorization: `Bearer ${token}` };
    };
  }
  return cachedAuthHeaders();
}

export async function initializeTracing(enabled: boolean): Promise<void> {
  if (!enabled || activeSdk) {
    return;
  }

  try {
    const [
      { NodeSDK },
      { HttpInstrumentation },
      { PgInstrumentation },
      { OTLPTraceExporter },
      { OTLPMetricExporter },
      { PeriodicExportingMetricReader },
      { resourceFromAttributes },
      { diag, DiagLogLevel },
    ] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/instrumentation-http'),
      import('@opentelemetry/instrumentation-pg'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/exporter-metrics-otlp-http'),
      import('@opentelemetry/sdk-metrics'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/api'),
    ]);

    const auth = await getGoogleAuth();
    const projectId = await resolveGcpProjectId(auth);
    if (!projectId) {
      console.warn('OpenTelemetry: GCP project id unavailable');
      return;
    }

    diag.setLogger(
      {
        verbose: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: (message, ...args) => {
          const text = [String(message), ...args.map(String)].join(' ');
          if (isSafeToLogOpenTelemetryMessage(text)) {
            console.error(text);
          }
        },
      },
      DiagLogLevel.ERROR,
    );

    const headers = () => buildAuthHeaders();

    const traceExporter = new OTLPTraceExporter({
      url: OTLP_TRACES_URL,
      headers,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: OTLP_METRICS_URL,
        headers,
      }),
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
    });

    const serviceName =
      typeof process.env.K_SERVICE === 'string' &&
      process.env.K_SERVICE.length > 0
        ? process.env.K_SERVICE
        : 'tax-service';

    const sdk = new NodeSDK({
      serviceName,
      resource: resourceFromAttributes({
        'service.name': serviceName,
        'gcp.project_id': projectId,
      }),
      traceExporter,
      metricReaders: [metricReader],
      instrumentations: [new HttpInstrumentation(), new PgInstrumentation()],
    });

    sdk.start();
    activeSdk = sdk;
    console.info('OpenTelemetry exporting traces and metrics');
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
