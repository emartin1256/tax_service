const INSTANT_WITH_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function isValidInstantTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !INSTANT_WITH_TIMEZONE.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

export function parseInstantToUtcDate(value: string): Date {
  if (!isValidInstantTimestamp(value)) {
    throw new Error('Invalid instant timestamp');
  }
  return new Date(value);
}

export function formatInstant(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  const milliseconds = date.getUTCMilliseconds();

  if (milliseconds === 0) {
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
  }

  const ms = String(milliseconds).padStart(3, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}Z`;
}
