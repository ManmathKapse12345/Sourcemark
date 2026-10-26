import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import type { Env } from "../env.js";

export interface TokenClaims {
  sub: string;
  email: string;
  name: string | null;
}

export type TokenVerifier = (token: string) => Promise<TokenClaims>;

// Verifies Supabase access tokens. HS256 tokens use the shared secret (Supabase legacy keys, or
// tokens minted locally by scripts/token.ts); asymmetric tokens use the project's JWKS endpoint.
export function createTokenVerifier(env: Pick<Env, "AUTH_JWT_SECRET" | "SUPABASE_URL" | "AUTH_AUDIENCE">): TokenVerifier {
  const secret = env.AUTH_JWT_SECRET ? new TextEncoder().encode(env.AUTH_JWT_SECRET) : null;
  const jwks = env.SUPABASE_URL
    ? createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", env.SUPABASE_URL))
    : null;

  return async (token) => {
    const { alg } = decodeProtectedHeader(token);
    let payload: JWTPayload;
    if (alg === "HS256") {
      if (!secret) throw new Error("HS256 tokens are not accepted");
      ({ payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], audience: env.AUTH_AUDIENCE }));
    } else {
      if (!jwks) throw new Error("Asymmetric tokens are not accepted");
      ({ payload } = await jwtVerify(token, jwks, {
        algorithms: ["RS256", "ES256"],
        audience: env.AUTH_AUDIENCE,
        issuer: new URL("/auth/v1", env.SUPABASE_URL).toString(),
      }));
    }
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!payload.sub || !email) throw new Error("Token is missing sub or email");
    const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
    const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
    return { sub: payload.sub, email: email.toLowerCase(), name };
  };
}
