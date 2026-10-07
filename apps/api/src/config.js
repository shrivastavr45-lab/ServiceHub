import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  BCRYPT_ROUNDS: z.coerce.number().default(10),
  SEED_PASSWORD: z.string().default('Password123!'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
