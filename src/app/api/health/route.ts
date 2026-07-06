import { wispDb } from "@/lib/server/db/client";
import { log } from "@/lib/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Container/uptime probe: verifies the app can actually reach its database
 * (URL, key, and Data API schema exposure all in one round trip), not just
 * that the process accepts TCP — a share app whose Supabase is down should
 * report unhealthy so the orchestrator stops routing to it. Status only in
 * the body: the tunnel makes this publicly reachable, so no versions/config.
 */
export async function GET(): Promise<Response> {
  try {
    const { error } = await wispDb().from("shares").select("id").limit(1);
    if (error) throw new Error(`db probe failed: ${error.message}`);
    return Response.json({ ok: true });
  } catch (error) {
    log.error("health.check_failed", { error });
    return Response.json({ ok: false }, { status: 503 });
  }
}
