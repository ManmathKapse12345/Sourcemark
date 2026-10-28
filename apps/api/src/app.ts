import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AnalysisClient } from "./analysis/client.js";
import { authenticate, loadMembership } from "./auth/middleware.js";
import type { TokenVerifier } from "./auth/tokens.js";
import { prisma } from "./db.js";
import { errorHandler, notFound } from "./http/errors.js";
import { logger } from "./logger.js";
import { brandKitRouter } from "./routes/brandKit.js";
import { contentRouter } from "./routes/content.js";
import { accountRouter, membersRouter } from "./routes/orgs.js";

export interface AppDeps {
  analysis: AnalysisClient;
  verifyToken: TokenVerifier;
  corsOrigins: string[];
  maxUploadMb: number;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigins, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/health" } }));

  app.get("/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use(authenticate(deps.verifyToken));
  api.use((_req, _res, next) => { deps.analysis.warm?.(); next(); });
  api.use(accountRouter());

  const org = express.Router({ mergeParams: true });
  org.use(loadMembership);
  org.use(membersRouter());
  org.use(brandKitRouter(deps.analysis, deps.maxUploadMb));
  org.use(contentRouter(deps.analysis, deps.maxUploadMb));
  api.use("/orgs/:orgId", org);

  app.use("/api", api);
  app.use((_req, _res, next) => next(notFound("Route")));
  app.use(errorHandler);
  return app;
}
