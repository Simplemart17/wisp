import { env } from "@/lib/server/env";
import { errorResponse, jsonResponse } from "@/lib/server/http";
import { runSweep } from "@/lib/server/services/sweep";
import { sha256Base64Url, tokenMatchesHash } from "@/lib/server/tokens";

export const runtime = "nodejs";

/**
 * External trigger for the expiry sweeper — optional, for operators who
 * prefer their own cron; production servers already sweep on an internal
 * timer (boot.ts). Disabled (404) unless WISP_SWEEP_SECRET is set.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const secret = env.sweepSecret;
    const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!secret || !presented || !tokenMatchesHash(presented, sha256Base64Url(secret))) {
      return jsonResponse({ error: "Not found", kind: null }, 404);
    }
    return jsonResponse({ swept: await runSweep() });
  } catch (error) {
    return errorResponse(error);
  }
}
