import { enforceRateLimit, errorResponse, jsonResponse, readJsonBody } from "@/lib/server/http";
import { parseCreateShare } from "@/lib/server/policy";
import { senderUserId } from "@/lib/server/sender-auth";
import { createShare } from "@/lib/server/services/create-share";

export const runtime = "nodejs";

/**
 * Create a share (SPEC §8). The management token is returned exactly once;
 * only its hash is stored. Identity shares also mint one child link +
 * recipient per email — see the create-share service.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "shares", 20, 10 * 60 * 1000);
    const input = parseCreateShare(await readJsonBody(req));
    // Clerk-signed-in senders get share history (SPEC §5b); null = anonymous.
    const result = await createShare(input, await senderUserId());
    return jsonResponse(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
