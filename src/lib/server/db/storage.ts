/**
 * Storage seam: the only module that talks to the private ciphertext bucket.
 * Routes/services request signed URLs and deletions through here rather than
 * reaching into supabase-js Storage directly.
 */
import { log } from "../log";
import { CIPHERTEXT_BUCKET, wispDb } from "./client";

export async function createSignedUploadUrl(path: string): Promise<{ path: string; url: string }> {
  const { data, error } = await wispDb()
    .storage.from(CIPHERTEXT_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message}`);
  return { path: data.path, url: data.signedUrl };
}

export async function createSignedDownloadUrl(path: string, ttlSeconds: number): Promise<string> {
  const { data, error } = await wispDb()
    .storage.from(CIPHERTEXT_BUCKET)
    .createSignedUrl(path, ttlSeconds);
  if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message}`);
  return data.signedUrl;
}

/** Best-effort blob deletion; logs on failure but never throws. */
export async function removeBlobs(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await wispDb().storage.from(CIPHERTEXT_BUCKET).remove(paths);
  if (error) log.error("storage.blob_delete_failed", { error: error.message, count: paths.length });
}

/** Throwing variant for the revoke path, where a failed delete must abort. */
export async function removeBlobsStrict(paths: string[]): Promise<void> {
  const { error } = await wispDb().storage.from(CIPHERTEXT_BUCKET).remove(paths);
  if (error) throw new Error(`blob delete failed: ${error.message}`);
}
