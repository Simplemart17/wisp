import { createClient } from "@supabase/supabase-js";

import { requireSupabase } from "./env";

/** Private bucket holding ciphertext blobs, released only via signed URLs. */
export const CIPHERTEXT_BUCKET = "wisp";

export const MAX_CIPHERTEXT_BYTES = 128 * 1024 * 1024; // ciphertext incl. chunk overhead
export const MAX_ENCRYPTED_METADATA_BYTES = 4096;

function createWispClient(url: string, secretKey: string) {
  return createClient(url, secretKey, {
    db: { schema: "wisp" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type WispClient = ReturnType<typeof createWispClient>;

let cached: WispClient | null = null;

/**
 * Server-only Supabase client, authenticated with the secret key
 * (`sb_secret_…`, runs as the service_role Postgres role) and pinned to the
 * dedicated `wisp` schema. Never import this from client code.
 */
export function wispDb(): WispClient {
  if (cached) return cached;
  const { url, secretKey } = requireSupabase();
  cached = createWispClient(url, secretKey);
  return cached;
}
