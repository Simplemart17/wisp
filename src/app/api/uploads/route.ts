import { createSignedUploadUrl } from "@/lib/server/db/storage";
import { ApiError, enforceRateLimit, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { MAX_CIPHERTEXT_BYTES } from "@/lib/server/supabase";
import { generateBlobPath } from "@/lib/server/tokens";

export const runtime = "nodejs";

/**
 * Step 1 of share creation: mint a signed upload URL for the private bucket.
 * The ciphertext goes straight from the browser to Storage — never through
 * this server — and the path is unguessable, so only the uploader can later
 * reference it from POST /api/shares.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "uploads", 30, 10 * 60 * 1000);

    const body = await readJsonBody(req);
    const size = body.size;
    if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > MAX_CIPHERTEXT_BYTES) {
      throw new ApiError(400, `size must be 1..${MAX_CIPHERTEXT_BYTES} bytes`);
    }

    const { path, url } = await createSignedUploadUrl(generateBlobPath());
    return jsonResponse({ path, url });
  } catch (error) {
    return errorResponse(error);
  }
}
