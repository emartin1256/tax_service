import { z } from 'zod';

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return false;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return value === 'true' || value === '1';
  });

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    DIRECT_DATABASE_URL: z.string().min(1).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    OTEL_ENABLED: booleanFromEnv,
  })
  .transform((data) => ({
    ...data,
    DIRECT_DATABASE_URL: data.DIRECT_DATABASE_URL ?? data.DATABASE_URL,
  }));

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    console.error('Invalid environment configuration:', formatted);
    process.exit(1);
  }
  return result.data;
}
