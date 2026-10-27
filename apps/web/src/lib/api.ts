export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;
let onUnauthenticated: () => void = () => {};

export function configureApi(opts: { getToken: TokenGetter; onUnauthenticated: () => void }) {
  getToken = opts.getToken;
  onUnauthenticated = opts.onUnauthenticated;
}

/** JSON request helper. Pass FormData as body for uploads (no Content-Type: the browser sets the boundary). */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) onUnauthenticated();
    const e = data?.error;
    const code = e?.code ?? "error";
    // The analysis service is down or has no AI key: say what that means instead of a raw upstream error.
    const message = code === "analysis_unavailable"
      ? "This step needs the analysis service, which isn't available right now. Try again in a minute, or ask your admin to check the AI settings."
      : e?.message ?? res.statusText;
    throw new ApiError(res.status, code, message, e?.details ?? e?.message);
  }
  return data as T;
}
