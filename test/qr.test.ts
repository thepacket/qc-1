import { describe, test, expect } from "vitest";
import jsQR from "jsqr";
import { makeQr, QR_MAX, type Qr } from "../src/qasm/qr";
import { shareHash } from "../src/qasm/share";
import { randomTape, rng } from "../validation/cases/tapes";
import { importQasm } from "../src/qasm/import";
import { readFileSync } from "node:fs";

/** Render the code to RGBA (quiet zone 4, `px` pixels per module) and read it back with jsQR. */
function decode(qr: Qr, px = 3): string | null {
  const side = (qr.size + 8) * px;
  const img = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) {
    if (!qr.dark[r * qr.size + c]) continue;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const o = (((r + 4) * px + y) * side + (c + 4) * px + x) * 4;
      img[o] = img[o + 1] = img[o + 2] = 0;
    }
  }
  return jsQR(img, side, side)?.data ?? null;
}

const ORIGIN = "https://qc1.fly.dev/";

describe("QR codes for share links", () => {
  test("random tapes: the code reads back as the exact link", async () => {
    const r = rng(5);
    for (let trial = 0; trial < 12; trial++) {
      const n = 1 + r.int(8);
      const link = ORIGIN + await shareHash(n, randomTape(r, n, 2 + r.int(40)), trial % 2 ? { theta: r.next() } : {});
      const qr = makeQr(link)!;
      expect(qr, `${link.length} chars`).not.toBeNull();
      expect(decode(qr)).toBe(link);
    }
  });

  test("examples up to the capacity; beyond it, no code", async () => {
    let largest = 0;
    for (const file of ["bell.qasm", "teleport_dynamic.qasm", "grover_3q.qasm"]) {
      const { n, tape } = importQasm(readFileSync(`examples/${file}`, "utf8"));
      const link = ORIGIN + await shareHash(n, tape, {});
      const qr = makeQr(link);
      if (link.length > QR_MAX.L) {
        expect(qr).toBeNull();
        continue;
      }
      expect(decode(qr!)).toBe(link);
      largest = Math.max(largest, qr!.version);
    }
    expect(largest).toBeGreaterThan(0);
    expect(makeQr("x".repeat(QR_MAX.L + 1))).toBeNull();
    const full = makeQr(ORIGIN + "#q=" + "A".repeat(QR_MAX.L - ORIGIN.length - 3))!;
    expect(full.version).toBe(40);
    expect(full.level).toBe("L");
    expect(decode(full, 2)).toBe(ORIGIN + "#q=" + "A".repeat(QR_MAX.L - ORIGIN.length - 3));
  });
});
