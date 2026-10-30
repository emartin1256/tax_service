import {
  initializeTracing,
  isGcpProjectIdUnavailableError,
  isSafeToLogOpenTelemetryMessage,
  parseGceMetadataRegionBody,
} from './tracing';

describe('tracing', () => {
  describe('parseGceMetadataRegionBody', () => {
    it('returns the region segment from GCE metadata bodies', () => {
      expect(
        parseGceMetadataRegionBody('projects/123/regions/us-central1'),
      ).toBe('us-central1');
      expect(parseGceMetadataRegionBody('projects/123/zones/us-central1-a')).toBe(
        undefined,
      );
      expect(parseGceMetadataRegionBody('')).toBe(undefined);
    });
  });

  describe('isGcpProjectIdUnavailableError', () => {
    it('matches google-auth missing project id errors', () => {
      expect(
        isGcpProjectIdUnavailableError(
          new Error(
            'Unable to detect a Project Id in the current environment.',
          ),
        ),
      ).toBe(true);
      expect(isGcpProjectIdUnavailableError(new Error('network failure'))).toBe(
        false,
      );
    });
  });

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
