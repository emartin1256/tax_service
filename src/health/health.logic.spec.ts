import { getLiveResponse, getReadyResponse } from './health.logic';

describe('health.logic', () => {
  it('live returns ok', () => {
    expect(getLiveResponse()).toEqual({ status: 'ok' });
  });

  it('ready returns ok when ping succeeds', async () => {
    await expect(
      getReadyResponse(async () => {
        /* no-op */
      }),
    ).resolves.toEqual({ status: 'ok' });
  });

  it('ready propagates ping failures', async () => {
    await expect(
      getReadyResponse(async () => {
        throw new Error('connection refused');
      }),
    ).rejects.toThrow('connection refused');
  });
});
