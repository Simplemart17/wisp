import { ApiError, clientIp, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { CIPHERTEXT_BUCKET, MAX_CIPHERTEXT_BYTES, wispDb } from "@/lib/server/supabase";
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
    if (!rateLimit(`uploads:${clientIp(req)}`, 30, 10 * 60 * 1000)) {
      throw new ApiError(429, "Too many uploads, slow down");
    }

    const body = await readJsonBody(req);
    const size = body.size;
    if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > MAX_CIPHERTEXT_BYTES) {
      throw new ApiError(400, `size must be 1..${MAX_CIPHERTEXT_BYTES} bytes`);
    }

    const path = generateBlobPath();
    const { data, error } = await wispDb()
      .storage.from(CIPHERTEXT_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      throw new Error(`createSignedUploadUrl failed: ${error?.message}`);
    }
    return jsonResponse({ path: data.path, url: data.signedUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
