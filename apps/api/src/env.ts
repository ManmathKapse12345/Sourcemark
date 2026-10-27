import "dotenv/config";
import { z } from "zod";

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().min(1),
    // Accepts a bare "host:port" too (what Render's fromService hostport provides).
    ANALYSIS_URL: z
      .string()
      .default("http://localhost:8000")
      .transform((u) => (/^https?:\/\//.test(u) ? u : `http://${u}`))
      .pipe(z.url()),
    // Shared secret sent to the internal analysis service on every call.
    ANALYSIS_TOKEN: z.string().min(16),
    ANALYSIS_TIMEOUT_MS: z.coerce.number().int().default(180_000),
    // HS256 secret: Supabase's legacy JWT secret, or a local secret for development.
    AUTH_JWT_SECRET: z.string().min(32).optional(),
    // When set, asymmetric Supabase tokens are verified against the project's JWKS.
    SUPABASE_URL: z.url().optional(),
    AUTH_AUDIENCE: z.string().default("authenticated"),
    CORS_ORIGINS: z.string().default("http://localhost:3000"),
    MAX_UPLOAD_MB: z.coerce.number().default(10),
  })
  .refine((e) => e.AUTH_JWT_SECRET || e.SUPABASE_URL, {
    message: "Set AUTH_JWT_SECRET or SUPABASE_URL so access tokens can be verified",
  });

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "env"}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
