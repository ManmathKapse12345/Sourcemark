import { randomUUID } from "node:crypto";
import type { AnalyzeRequest, AnalyzeResponse, FindingDTO, ImageAnalyzeRequest, ImageAnalyzeResponse, RewordClauseRequest } from "@sourcemark/contract";
import { SignJWT } from "jose";
import request from "supertest";
import type { AnalysisClient } from "../src/analysis/client.js";
import { createApp } from "../src/app.js";
import { createTokenVerifier } from "../src/auth/tokens.js";
import { upstream } from "../src/http/errors.js";

export const SECRET = "test-secret-test-secret-test-secret-123";

export async function tokenFor(user: { id: string; email: string }) {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

// A stand-in for the Python service with two fixed checks, so workflow tests are deterministic:
// "Cream" is a violation with a fix; "miracle" is a violation without one.
export class FakeAnalysis implements AnalysisClient {
  down = false;
  calls: AnalyzeRequest[] = [];

  async analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    this.calls.push(req);
    if (this.down) throw upstream("Analysis service unreachable: connect ECONNREFUSED");
    const text = req.content.text;
    const findings: FindingDTO[] = [];
    const add = (word: string, fp: string, fix: string | null) => {
      const start = text.indexOf(word);
      if (start < 0) return;
      findings.push({
        fingerprint: fp, kind: "violation", category: "terminology", severity: "high", origins: ["rule"],
        span: { start, end: start + word.length }, quote: word, explanation: `${word} is not allowed.`,
        source: { type: "rule", code: fp === "fp-cream" ? "R-4" : "R-1", clause_code: "G-1.1", text: "Use the approved product name." },
        confidence: 1, fix: fix === null ? null : { start, end: start + word.length, replacement: fix }, box: null,
      });
    };
    add("Cream", "fp-cream", "Moisturiser");
    add("miracle", "fp-miracle", null);
    return {
      findings, rewrites: [], ai_status: "disabled", ai_error: null, model: null,
      stats: { rule_findings: findings.length, ai_findings: 0, ai_downgraded: 0, ai_dropped_unanchored: 0, merged: 0, language: "en", duration_ms: 1 },
    };
  }
  // Image posts: an off-palette colour (with a box) and, until alt text is set, the missing-alt-text check.
  imageCalls: { req: ImageAnalyzeRequest; bytes: number }[] = [];
  async analyzeImage(req: ImageAnalyzeRequest, image: { buffer: Buffer }): Promise<ImageAnalyzeResponse> {
    this.imageCalls.push({ req, bytes: image.buffer.length });
    const findings: FindingDTO[] = [{
      fingerprint: "fp-colour", kind: "violation", category: "visual", severity: "medium", origins: ["rule"], span: null,
      quote: "#E0317A", explanation: "#E0317A is not a brand colour.", confidence: 1, fix: null,
      source: { type: "asset", code: "A-1", clause_code: null, text: "Palette: #1F4D3A" }, box: { x: 0, y: 0.5, w: 1, h: 0.2 },
    }];
    if (!req.alt_text) {
      findings.push({
        fingerprint: "fp-alt", kind: "violation", category: "accessibility", severity: "medium", origins: ["rule"], span: null,
        quote: "", explanation: "No alt text.", confidence: 1, fix: null, box: null,
        source: { type: "standard", code: "WCAG-1.1.1", clause_code: null, text: "Images need a text alternative." },
      });
    }
    return {
      findings, rewrites: [], ai_status: "disabled", ai_error: null, model: null, ocr_text: "Now just ₹499",
      image: { width: 1080, height: 1080 }, notes: ["AI checks are off, so the text in the image was not checked."],
      stats: { rule_findings: findings.length, ai_findings: 0, ai_downgraded: 0, ai_dropped_unanchored: 0, merged: 0, language: "en", duration_ms: 1 },
    };
  }
  async parse() {
    return { text: "Parsed document text with Cream.", format: "docx" as const, warnings: [] };
  }
  async extractGuideline({ prefix }: { prefix: string }) {
    return { clauses: [{ code: `${prefix}-1.1`, heading: "Names", text: "Use the approved product name." }], warnings: [] };
  }
  async embed() {
    return null;
  }
  async suggestRules() {
    return { suggestions: [] };
  }
  rewordCalls: RewordClauseRequest[] = [];
  async rewordClause(req: RewordClauseRequest) {
    this.rewordCalls.push(req);
    return { text: `${req.clause.text} Factual descriptions are allowed.`, rationale: "People disputed factual wording.", case_ids: [req.cases[0]!.id] };
  }
}

export function makeApp(analysis = new FakeAnalysis()) {
  const app = createApp({
    analysis,
    verifyToken: createTokenVerifier({ AUTH_JWT_SECRET: SECRET, AUTH_AUDIENCE: "authenticated", SUPABASE_URL: undefined }),
    corsOrigins: ["http://localhost:3000"],
    maxUploadMb: 5,
  });
  return { app, analysis };
}

export function newUser(label: string) {
  const id = randomUUID();
  return { id, email: `${label}-${id.slice(0, 8)}@example.test` };
}

// Signs a user in (which creates their User row) and returns a request helper bound to their token.
export async function signIn(app: Parameters<typeof request>[0], user: { id: string; email: string }) {
  const token = await tokenFor(user);
  const auth = { Authorization: `Bearer ${token}` };
  await request(app).get("/api/me").set(auth).expect(200);
  return {
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string, body?: object) => request(app).post(url).set(auth).send(body ?? {}),
    patch: (url: string, body?: object) => request(app).patch(url).set(auth).send(body ?? {}),
    raw: () => request(app),
    auth,
  };
}
