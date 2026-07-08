/**
 * Next.js instrumentation hook — runs once when the server starts, before any
 * request is served. Fails the boot on missing critical env (see boot.ts).
 */
export async function register(): Promise<void> {
  // The middleware bundle registers under the edge runtime too; env
  // validation only makes sense in the real Node server process.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertBootEnv, startSweeper } = await import("./lib/server/boot");
  assertBootEnv();
  startSweeper();
}
