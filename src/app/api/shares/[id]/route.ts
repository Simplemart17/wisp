import { errorResponse, jsonResponse } from "@/lib/server/http";
import { getShare, isExhausted, isExpired } from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * Pre-access status for the viewer's interstitial: whether the share still
 * exists and whether a password will be needed. Deliberately minimal — no
 * metadata, no policy details, nothing is consumed or logged here.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const share = await getShare(id);
    if (!share) return jsonResponse({ error: "Not found", kind: "gone" }, 404);
    return jsonResponse({
      requiresPassword: share.wrapped_cek !== null,
      expired: isExpired(share),
      exhausted: isExhausted(share),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
