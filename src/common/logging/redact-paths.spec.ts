import { PINO_REDACT_PATHS } from './redact-paths';

describe('PINO_REDACT_PATHS', () => {
  it('redacts authorization and monetary request body fields', () => {
    expect(PINO_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.body.cost',
        'req.body.taxRate',
        'req.body.amount',
        'req.body.items',
      ]),
    );
  });
});
