/**
 * Invisible forensic watermark — Phase 3 spike (SPEC §9, §13 "still open").
 *
 * Scheme: blind differential watermark in the frequency domain. The image is
 * split into 8×8 blocks; each block's luminance is DCT-transformed and one
 * payload bit is enforced as an ordering between two mid-frequency
 * coefficients (swapped-pair method). The 40-bit payload (32-bit access id +
 * 8-bit checksum) repeats across all blocks and decodes by weighted majority
 * vote, so it survives recompression and moderate pixel noise.
 *
 * Honest scope of this v1: robust to re-encoding (PNG/JPEG), mild noise and
 * brightness shifts; NOT yet robust to cropping, scaling or photographing a
 * screen (those need geometric sync marks — future work). Still client-
 * honored: traceability, not prevention.
 */

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

const BLOCK = 8;
const PAYLOAD_BITS = 40; // 32-bit id + 8-bit checksum
// Mid-frequency coefficient pair — similar JPEG quantization treatment.
const COEFF_A: [number, number] = [2, 3];
const COEFF_B: [number, number] = [3, 2];
const MARGIN = 14; // enforced |a-b| separation in DCT luma units

// Precomputed DCT-II basis: cos((2x+1)uπ/16) and normalization c(u).
const COS = (() => {
  const t: number[][] = [];
  for (let x = 0; x < BLOCK; x++) {
    t.push([]);
    for (let u = 0; u < BLOCK; u++) {
      t[x][u] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * BLOCK));
    }
  }
  return t;
})();
const NORM = Array.from({ length: BLOCK }, (_, u) => (u === 0 ? Math.SQRT1_2 : 1));

function dct2d(block: Float64Array, out: Float64Array): void {
  for (let u = 0; u < BLOCK; u++) {
    for (let v = 0; v < BLOCK; v++) {
      let sum = 0;
      for (let x = 0; x < BLOCK; x++) {
        for (let y = 0; y < BLOCK; y++) {
          sum += block[x * BLOCK + y] * COS[x][u] * COS[y][v];
        }
      }
      out[u * BLOCK + v] = (NORM[u] * NORM[v] * sum) / 4;
    }
  }
}

function idct2d(coeffs: Float64Array, out: Float64Array): void {
  for (let x = 0; x < BLOCK; x++) {
    for (let y = 0; y < BLOCK; y++) {
      let sum = 0;
      for (let u = 0; u < BLOCK; u++) {
        for (let v = 0; v < BLOCK; v++) {
          sum += NORM[u] * NORM[v] * coeffs[u * BLOCK + v] * COS[x][u] * COS[y][v];
        }
      }
      out[x * BLOCK + y] = sum / 4;
    }
  }
}

function checksum(id: number): number {
  return (
    ((id & 0xff) ^ ((id >>> 8) & 0xff) ^ ((id >>> 16) & 0xff) ^ ((id >>> 24) & 0xff) ^ 0xa5) & 0xff
  );
}

function payloadBits(id: number): number[] {
  const bits: number[] = [];
  for (let i = 0; i < 32; i++) bits.push((id >>> i) & 1);
  const check = checksum(id);
  for (let i = 0; i < 8; i++) bits.push((check >>> i) & 1);
  return bits;
}

/** Embed `accessId` into the image in place. Returns false if it can't fit. */
export function embedForensic(image: RgbaImage, accessId: number): boolean {
  const { data, width, height } = image;
  const blocksX = Math.floor(width / BLOCK);
  const blocksY = Math.floor(height / BLOCK);
  if (blocksX * blocksY < PAYLOAD_BITS) return false;

  const bits = payloadBits(accessId >>> 0);
  const luma = new Float64Array(BLOCK * BLOCK);
  const coeffs = new Float64Array(BLOCK * BLOCK);
  const restored = new Float64Array(BLOCK * BLOCK);
  const ia = COEFF_A[0] * BLOCK + COEFF_A[1];
  const ib = COEFF_B[0] * BLOCK + COEFF_B[1];

  let blockIndex = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++, blockIndex++) {
      const bit = bits[blockIndex % PAYLOAD_BITS];

      for (let x = 0; x < BLOCK; x++) {
        for (let y = 0; y < BLOCK; y++) {
          const p = ((by * BLOCK + x) * width + bx * BLOCK + y) * 4;
          luma[x * BLOCK + y] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        }
      }
      dct2d(luma, coeffs);

      const a = coeffs[ia];
      const b = coeffs[ib];
      const mid = (a + b) / 2;
      const half = MARGIN / 2;
      if (bit === 1) {
        coeffs[ia] = Math.max(a, mid + half);
        coeffs[ib] = Math.min(b, mid - half);
      } else {
        coeffs[ia] = Math.min(a, mid - half);
        coeffs[ib] = Math.max(b, mid + half);
      }

      idct2d(coeffs, restored);
      for (let x = 0; x < BLOCK; x++) {
        for (let y = 0; y < BLOCK; y++) {
          const delta = restored[x * BLOCK + y] - luma[x * BLOCK + y];
          if (delta === 0) continue;
          const p = ((by * BLOCK + x) * width + bx * BLOCK + y) * 4;
          data[p] = Math.max(0, Math.min(255, data[p] + delta));
          data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + delta));
          data[p + 2] = Math.max(0, Math.min(255, data[p + 2] + delta));
        }
      }
    }
  }
  return true;
}

/** Blind extraction: weighted majority vote across blocks; null if no valid mark. */
export function extractForensic(image: RgbaImage): number | null {
  const { data, width, height } = image;
  const blocksX = Math.floor(width / BLOCK);
  const blocksY = Math.floor(height / BLOCK);
  if (blocksX * blocksY < PAYLOAD_BITS) return null;

  const votes = new Float64Array(PAYLOAD_BITS);
  const luma = new Float64Array(BLOCK * BLOCK);
  const coeffs = new Float64Array(BLOCK * BLOCK);
  const ia = COEFF_A[0] * BLOCK + COEFF_A[1];
  const ib = COEFF_B[0] * BLOCK + COEFF_B[1];

  let blockIndex = 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++, blockIndex++) {
      for (let x = 0; x < BLOCK; x++) {
        for (let y = 0; y < BLOCK; y++) {
          const p = ((by * BLOCK + x) * width + bx * BLOCK + y) * 4;
          luma[x * BLOCK + y] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        }
      }
      dct2d(luma, coeffs);
      votes[blockIndex % PAYLOAD_BITS] += coeffs[ia] - coeffs[ib];
    }
  }

  let id = 0;
  for (let i = 0; i < 32; i++) {
    if (votes[i] > 0) id |= 1 << i;
  }
  id = id >>> 0;
  let check = 0;
  for (let i = 0; i < 8; i++) {
    if (votes[32 + i] > 0) check |= 1 << i;
  }
  return check === checksum(id) ? id : null;
}
