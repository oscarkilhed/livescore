/**
 * Structured logger — stdout plus OpenTelemetry logs.
 * ===================================================
 *
 * Every call writes to stdout/stderr (preserving the existing container-console
 * behavior on Lightsail) AND emits an OTel LogRecord. When telemetry is disabled
 * the global logger provider is a no-op, so the emit is free and only the console
 * output remains.
 *
 * Prefer this over raw `console.*` so log context travels as structured
 * attributes (matchType/matchId/division, error details) into Loki rather than
 * being baked into a message string.
 */
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const otelLogger = logs.getLogger('livescore-server');

type Attributes = Record<string, string | number | boolean | undefined>;

/** Drop undefined values so we don't emit empty attributes. */
function clean(attributes?: Attributes): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (attributes) {
    for (const [k, v] of Object.entries(attributes)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

function emit(
  severityNumber: SeverityNumber,
  severityText: string,
  message: string,
  attributes?: Attributes,
): void {
  otelLogger.emit({
    severityNumber,
    severityText,
    body: message,
    attributes: clean(attributes),
  });
}

export const logger = {
  info(message: string, attributes?: Attributes): void {
    // eslint-disable-next-line no-console
    console.log(message);
    emit(SeverityNumber.INFO, 'INFO', message, attributes);
  },
  warn(message: string, attributes?: Attributes): void {
    // eslint-disable-next-line no-console
    console.warn(message);
    emit(SeverityNumber.WARN, 'WARN', message, attributes);
  },
  error(message: string, attributes?: Attributes): void {
    // eslint-disable-next-line no-console
    console.error(message);
    emit(SeverityNumber.ERROR, 'ERROR', message, attributes);
  },
};
