export function getLiveResponse(): { status: 'ok' } {
  return { status: 'ok' };
}

export async function getReadyResponse(
  ping: () => Promise<void>,
): Promise<{ status: 'ok' }> {
  await ping();
  return { status: 'ok' };
}
