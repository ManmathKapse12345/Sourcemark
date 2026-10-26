import { createAnalysisClient } from "./analysis/client.js";
import { createApp } from "./app.js";
import { createTokenVerifier } from "./auth/tokens.js";
import { prisma } from "./db.js";
import { loadEnv } from "./env.js";
import { logger } from "./logger.js";

const env = loadEnv();

const app = createApp({
  analysis: createAnalysisClient({ baseUrl: env.ANALYSIS_URL, token: env.ANALYSIS_TOKEN, timeoutMs: env.ANALYSIS_TIMEOUT_MS }),
  verifyToken: createTokenVerifier(env),
  corsOrigins: env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  maxUploadMb: env.MAX_UPLOAD_MB,
});

const server = app.listen(env.PORT, () => logger.info(`Sourcemark API listening on :${env.PORT}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void prisma.$disconnect().then(() => process.exit(0)));
  });
}
