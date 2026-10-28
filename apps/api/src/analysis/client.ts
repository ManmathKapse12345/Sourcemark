import {
  AnalyzeResponse,
  EmbedResponse,
  ExtractGuidelineResponse,
  ParseResponse,
  SuggestRulesResponse,
  type AnalyzeRequest,
  type EmbedRequest,
  type SuggestRulesRequest,
} from "@sourcemark/contract";
import type { z } from "zod";
import { HttpError, upstream } from "../http/errors.js";

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface AnalysisClient {
  analyze(req: AnalyzeRequest): Promise<AnalyzeResponse>;
  parse(file: UploadedFile): Promise<ParseResponse>;
  extractGuideline(input: { file?: UploadedFile; text?: string; prefix: string }): Promise<ExtractGuidelineResponse>;
  embed(req: EmbedRequest): Promise<EmbedResponse | null>; // null: embeddings not configured
  suggestRules(req: SuggestRulesRequest): Promise<SuggestRulesResponse>;
  warm?(): void; // fire-and-forget ping so a sleeping service is awake before the next review
}

// A free-plan service that is asleep answers 502/504 (or not at all) while it starts.
const WAKING = new Set([502, 504]);
const WAKE_WINDOW_MS = 90_000;
const RETRY_DELAY_MS = 3_000;
const WARM_EVERY_MS = 60_000;

// HTTP client for the internal FastAPI service. Every response is validated against the
// shared contract before the API trusts it.
export function createAnalysisClient(opts: { baseUrl: string; token: string; timeoutMs: number }): AnalysisClient {
  let lastWarm = 0;
  async function call<S extends z.ZodType>(path: string, init: RequestInit, schema: S): Promise<z.infer<S>> {
    const deadline = Date.now() + opts.timeoutMs;
    const retryUntil = Date.now() + Math.min(WAKE_WINDOW_MS, opts.timeoutMs / 2);
    let res: Response;
    for (;;) {
      try {
        res = await fetch(new URL(path, opts.baseUrl), {
          ...init,
          headers: { ...(init.headers ?? {}), "X-Internal-Token": opts.token },
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        });
      } catch (err) {
        if (Date.now() < retryUntil && (err as Error).name !== "TimeoutError") { await sleep(RETRY_DELAY_MS); continue; }
        throw upstream(`Analysis service unreachable: ${(err as Error).message}`);
      }
      if (!WAKING.has(res.status) || Date.now() >= retryUntil) break;
      await res.body?.cancel();
      await sleep(RETRY_DELAY_MS);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body && typeof body === "object" && "detail" in body ? body.detail : body;
      throw upstream(`Analysis service failed (${res.status})`, { status: res.status, detail });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw upstream("Analysis service returned an invalid response", parsed.error.issues);
    return parsed.data;
  }

  const json = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const form = (file: UploadedFile, fields: Record<string, string> = {}): RequestInit => {
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return { method: "POST", body: fd };
  };

  return {
    analyze: (req) => call("/analyze", json(req), AnalyzeResponse),
    parse: (file) => call("/parse", form(file), ParseResponse),
    extractGuideline: ({ file, text, prefix }) => {
      if (file) return call("/guidelines/extract", form(file, { prefix }), ExtractGuidelineResponse);
      const fd = new FormData();
      fd.append("text", text ?? "");
      fd.append("prefix", prefix);
      return call("/guidelines/extract", { method: "POST", body: fd }, ExtractGuidelineResponse);
    },
    embed: async (req) => {
      try {
        return await call("/embed", json(req), EmbedResponse);
      } catch (err) {
        // 503 from /embed means no embedding provider is configured; callers continue without vectors.
        if (err instanceof HttpError && (err.details as { status?: number } | undefined)?.status === 503) return null;
        throw err;
      }
    },
    suggestRules: (req) => call("/rules/suggest", json(req), SuggestRulesResponse),
    warm: () => {
      if (Date.now() - lastWarm < WARM_EVERY_MS) return;
      lastWarm = Date.now();
      fetch(new URL("/health", opts.baseUrl), { signal: AbortSignal.timeout(WAKE_WINDOW_MS) }).catch(() => {});
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
