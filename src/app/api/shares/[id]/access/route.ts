import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { accessShare } from "@/lib/server/services/access";
import { getShare } from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * The gate (SPEC §8): thin handler over the access service, which enforces
 * expiry/identity/view-limits and returns the signed URL + key-wrap material.
 * The password is never sent here; it only unlocks the CEK client-side.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ip = clientIp(req);
    if (!rateLimit(`access:${ip}`, 60, 10 * 60 * 1000) || !rateLimit(`access:${ip}:${id}`, 10, 60 * 1000)) {
      throw new ApiError(429, "Too many attempts, slow down");
    }

    const body = await readJsonBody(req);
    const share = await getShare(id);
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);

    const dto = await accessShare(share, {
      ip,
      userAgent: req.headers.get("user-agent") ?? "",
      email: body.email,
      code: body.code,
    });
    return jsonResponse(dto);
  } catch (error) {
    return errorResponse(error);
  }
}
