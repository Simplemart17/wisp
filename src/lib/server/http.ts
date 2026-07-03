/** Small helpers shared by all Route Handlers. */

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

/** Client IP for rate limiting / hashed audit logging. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
