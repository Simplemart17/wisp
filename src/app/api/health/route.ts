import { wispDb } from "@/lib/server/db/client";
import { consumeRateLimit } from "@/lib/server/db/ratelimit";
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
    // Every rate-limited route (all of them) hard-depends on this RPC; a
    // deploy that skipped `supabase db push` must report unhealthy instead
    // of serving 500s behind a green check. Generous budget — the probe
    // itself must never trip a limit.
    await consumeRateLimit("health-probe", 1_000_000, 60_000);
    return Response.json({ ok: true });
  } catch (error) {
    log.error("health.check_failed", { error });
    return Response.json({ ok: false }, { status: 503 });
  }
}
