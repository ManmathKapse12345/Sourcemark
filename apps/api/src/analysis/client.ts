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
}

// HTTP client for the internal FastAPI service. Every response is validated against the
// shared contract before the API trusts it.
export function createAnalysisClient(opts: { baseUrl: string; token: string; timeoutMs: number }): AnalysisClient {
  async function call<S extends z.ZodType>(path: string, init: RequestInit, schema: S): Promise<z.infer<S>> {
    let res: Response;
    try {
      res = await fetch(new URL(path, opts.baseUrl), {
        ...init,
        headers: { ...(init.headers ?? {}), "X-Internal-Token": opts.token },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      throw upstream(`Analysis service unreachable: ${(err as Error).message}`);
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
  };
}
