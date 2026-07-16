/**
 * OpenTelemetry bootstrap — Grafana Cloud (metrics + logs via direct OTLP).
 * ========================================================================
 *
 * This module wires up the global OpenTelemetry MeterProvider and LoggerProvider
 * so the rest of the app can call `metrics.getMeter(...)` / `logs.getLogger(...)`
 * without knowing anything about exporters.
 *
 * IMPORTANT: `initTelemetry()` must run BEFORE any instrument or logger is created
 * (i.e. before `./metrics` and `./logger` are first used), so it is invoked from
 * the very top of `index.ts`, right after `dotenv/config` populates the env it
 * reads. When monitoring is disabled (default), this is a no-op: the global OTel
 * API providers stay no-op and every downstream telemetry call is free.
 *
 * Export path: metrics/logs are pushed straight to an OTLP endpoint (e.g. Grafana
 * Cloud's OTLP gateway) over http/protobuf. The exporters read the standard
 * `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` (auth) env vars
 * themselves — we only decide *whether* to start them.
 */
import { metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { config } from './config';

let meterProvider: MeterProvider | undefined;
let loggerProvider: LoggerProvider | undefined;
let started = false;

/**
 * Initialize telemetry. Safe to call once; subsequent calls are ignored.
 * Returns true if telemetry was actually started, false if disabled.
 */
export function initTelemetry(): boolean {
  if (started) return Boolean(meterProvider);
  started = true;

  if (!config.monitoring.enabled) {
    return false;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.monitoring.serviceName,
    [ATTR_SERVICE_VERSION]: config.monitoring.serviceVersion,
    // Not yet stable in @opentelemetry/semantic-conventions' main export, so use
    // the literal attribute key.
    'deployment.environment.name': config.monitoring.deploymentEnv,
  });

  // --- Metrics: periodic push to the OTLP endpoint ---
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: config.monitoring.metricExportIntervalMs,
  });
  meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  metrics.setGlobalMeterProvider(meterProvider);

  // --- Logs: batched export to the OTLP endpoint ---
  loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  registerShutdownHooks();
  return true;
}

/**
 * Flush and shut down both providers. Called on process termination so the last
 * export window isn't lost when the container is killed on redeploy.
 */
export async function shutdownTelemetry(): Promise<void> {
  await Promise.allSettled([
    meterProvider?.shutdown(),
    loggerProvider?.shutdown(),
  ]);
  meterProvider = undefined;
  loggerProvider = undefined;
}

let hooksRegistered = false;
function registerShutdownHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  const onSignal = () => {
    // Best-effort flush; don't block shutdown indefinitely.
    void shutdownTelemetry();
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}

// Initialize on import. This MUST happen before any instrument (in ./metrics) or
// logger (in ./logger) is created, because the OTel API permanently binds an
// instrument to whatever provider is global at creation time. index.ts imports
// this module right after `dotenv/config` and before ./metrics, ./logger and
// ./graphql, so the global providers are in place first.
initTelemetry();
