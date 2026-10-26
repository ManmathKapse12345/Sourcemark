import { randomUUID } from "node:crypto";
import type { AnalyzeRequest, AnalyzeResponse, FindingDTO } from "@sourcemark/contract";
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
        source: { type: "rule", code: fp === "fp-cream" ? "R-4" : "R-1", clause_code: "G-1", text: "Clause text" },
        confidence: 1, fix: fix === null ? null : { start, end: start + word.length, replacement: fix },
      });
    };
    add("Cream", "fp-cream", "Moisturiser");
    add("miracle", "fp-miracle", null);
    return {
      findings, rewrites: [], ai_status: "disabled", ai_error: null, model: null,
      stats: { rule_findings: findings.length, ai_findings: 0, ai_downgraded: 0, ai_dropped_unanchored: 0, merged: 0, duration_ms: 1 },
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
