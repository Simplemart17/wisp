import { describe, expect, it } from "vitest";

import { type RgbaImage, embedForensic, extractForensic } from "../forensic";

/** Deterministic pseudo-random generator so failures reproduce. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Synthetic photo-ish content: gradients + deterministic noise. */
function makeImage(width: number, height: number, seed = 42): RgbaImage {
  const rand = lcg(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      data[p] = (x / width) * 220 + rand() * 25;
      data[p + 1] = (y / height) * 200 + rand() * 25;
      data[p + 2] = 120 + 80 * Math.sin(x / 17) + rand() * 25;
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

const ACCESS_ID = 3_141_592_653 >>> 0;

describe("forensic watermark", () => {
  it("round-trips the access id through embed → extract", () => {
    const image = makeImage(320, 240);
    expect(embedForensic(image, ACCESS_ID)).toBe(true);
    expect(extractForensic(image)).toBe(ACCESS_ID);
  });

  it("survives pixel noise (re-compression-like distortion)", () => {
    const image = makeImage(320, 240, 7);
    embedForensic(image, ACCESS_ID);
    const rand = lcg(99);
    for (let i = 0; i < image.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        image.data[i + c] = Math.max(0, Math.min(255, image.data[i + c] + (rand() * 6 - 3)));
      }
    }
    expect(extractForensic(image)).toBe(ACCESS_ID);
  });

  it("survives a uniform brightness shift", () => {
    const image = makeImage(320, 240, 13);
    embedForensic(image, ACCESS_ID);
    for (let i = 0; i < image.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        image.data[i + c] = Math.min(255, image.data[i + c] + 10);
      }
    }
    expect(extractForensic(image)).toBe(ACCESS_ID);
  });

  it("reports nothing on an unmarked image", () => {
    expect(extractForensic(makeImage(320, 240, 21))).toBeNull();
  });

  it("refuses images too small to carry the payload", () => {
    const tiny = makeImage(32, 32);
    expect(embedForensic(tiny, ACCESS_ID)).toBe(false);
    expect(extractForensic(tiny)).toBeNull();
  });

  it("distinguishes different access ids", () => {
    const a = makeImage(320, 240, 5);
    const b = makeImage(320, 240, 5);
    embedForensic(a, 1234567);
    embedForensic(b, 7654321);
    expect(extractForensic(a)).toBe(1234567);
    expect(extractForensic(b)).toBe(7654321);
  });
});
