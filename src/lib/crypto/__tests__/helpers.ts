import type { KdfParams } from "../keys";

// Deliberately weak Argon2id parameters so the suite stays fast; the
// production defaults are exercised once in keys.test.ts.
export const TEST_KDF_PARAMS: KdfParams = {
  algorithm: "argon2id",
  version: 19,
  iterations: 2,
  memorySize: 256,
  parallelism: 1,
  hashLength: 32,
};
