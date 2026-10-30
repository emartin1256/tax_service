import {
  initializeTracing,
  isSafeToLogOpenTelemetryMessage,
} from './tracing';

describe('tracing', () => {
  describe('isSafeToLogOpenTelemetryMessage', () => {
    it('refuses messages that contain Bearer or ya29.', () => {
      expect(isSafeToLogOpenTelemetryMessage('export failed')).toBe(true);
      expect(
        isSafeToLogOpenTelemetryMessage('Authorization: Bearer secret'),
      ).toBe(false);
      expect(isSafeToLogOpenTelemetryMessage('token ya29.abc')).toBe(false);
    });
  });

  describe('initializeTracing', () => {
    it('resolves without starting exporters when disabled', async () => {
      await expect(initializeTracing(false)).resolves.toBeUndefined();
    });
  });
});
