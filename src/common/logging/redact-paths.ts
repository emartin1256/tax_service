export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.body.cost',
  'req.body.taxRate',
  'req.body.amount',
  'req.body.items',
  'req.body.items[*].cost',
  'req.body.items[*].taxRate',
  'req.body.items[*].amount',
] as const;
