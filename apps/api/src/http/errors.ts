import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { logger } from "../logger.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);
export const forbidden = (message = "You do not have permission to do this") =>
  new HttpError(403, "forbidden", message);
// Used for "exists but not yours" too, so other organisations' ids are not revealed.
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, "conflict", message, details);
export const upstream = (message: string, details?: unknown) =>
  new HttpError(502, "analysis_unavailable", message, details);

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_failed", message: "Request is not valid", details: err.issues },
    });
    return;
  }
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: { code: "upload_rejected", message: err.message } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: { code: "conflict", message: "A record with these values already exists" } });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "not_found", message: "Record not found" } });
      return;
    }
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "bad_json", message: "Body is not valid JSON" } });
    return;
  }
  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "internal", message: "Something went wrong" } });
};
