/** Small helpers shared by all Route Handlers. */
import { rateLimit } from "./ratelimit";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Machine-readable kind surfaced to the client UI. */
    public readonly kind?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** Uniform error mapping: ApiError → its status; anything else → opaque 500. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message, kind: error.kind ?? null }, {
      status: error.status,
    });
  }
  console.error("[wisp] unhandled API error:", error);
  return Response.json({ error: "Internal error", kind: null }, { status: 500 });
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

/**
 * Client IP for rate limiting / hashed audit logging.
 *
 * The LEFTMOST X-Forwarded-For entry is client-supplied and trivially spoofed,
 * which would let an attacker mint a fresh rate-limit bucket per request and
 * forge audit IP hashes. Trusted proxies append the real peer on the RIGHT, so
 * we read `WISP_TRUSTED_PROXY_DEPTH` hops in from the right (default 1 — one
 * trusted proxy such as Vercel's edge). Operators behind N proxies set N;
 * self-hosters with no proxy set 0 to ignore XFF entirely.
 */
export function clientIp(req: Request): string {
  const depth = Number.parseInt(process.env.WISP_TRUSTED_PROXY_DEPTH ?? "1", 10);
  const xff = req.headers.get("x-forwarded-for");
  if (xff && Number.isInteger(depth) && depth >= 1) {
    const hops = xff
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    // depth hops from the right are our own trusted proxies; the client sits
    // just left of them. Clamp to the leftmost if the chain is shorter.
    const idx = Math.max(0, hops.length - depth);
    if (hops[idx]) return hops[idx];
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Per-request throttle: `maxRequests` per `windowMs` keyed by `scope` + client
 * IP. Throws a uniform 429 on trip. Centralizes the boilerplate that otherwise
 * repeats in every route.
 */
export function enforceRateLimit(
  req: Request,
  scope: string,
  maxRequests: number,
  windowMs: number,
): void {
  if (!rateLimit(`${scope}:${clientIp(req)}`, maxRequests, windowMs)) {
    throw new ApiError(429, "Too many requests, slow down");
  }
}
