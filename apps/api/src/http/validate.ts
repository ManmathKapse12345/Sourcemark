import type { z } from "zod";
import { badRequest } from "./errors.js";

export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  return schema.parse(body ?? {});
}

// Multipart forms send everything as strings; this turns "true"/"false" into booleans first.
export function parseForm<S extends z.ZodType>(schema: S, body: Record<string, unknown>): z.infer<S> {
  const coerced = Object.fromEntries(
    Object.entries(body ?? {}).map(([k, v]) => [k, v === "true" ? true : v === "false" ? false : v]),
  );
  return schema.parse(coerced);
}

export function param(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw badRequest(`Missing ${name}`);
  return value;
}
