/**
 * QR codes for share links (TAPE ≡ → QR code), so a tape shown on one screen
 * opens on the phones pointed at it. Encoding is qrcode-generator's (byte
 * mode); test/qr.test.ts decodes every code with an independent reader (jsQR)
 * and checks it gives back the exact link.
 *
 * Error correction M (15% damage) while the link fits, else L (7%), which
 * holds the most: 2331 and 2953 bytes at the largest size (version 40).
 */
import qrcode from "qrcode-generator";

export type Qr = { size: number; version: number; level: "M" | "L"; dark: Uint8Array };

/** Byte capacity of version 40, by level. */
export const QR_MAX = { M: 2331, L: 2953 } as const;

export function makeQr(text: string): Qr | null {
  for (const level of ["M", "L"] as const) {
    if (text.length > QR_MAX[level]) continue;
    const qr = qrcode(0, level);
    qr.addData(text, "Byte");
    try {
      qr.make();
    } catch {
      continue;
    }
    const size = qr.getModuleCount();
    const dark = new Uint8Array(size * size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark[r * size + c] = qr.isDark(r, c) ? 1 : 0;
    return { size, version: (size - 17) / 4, level, dark };
  }
  return null;
}

/** SVG path of the dark modules (one unit per module), offset by a quiet zone. */
export function qrPath(qr: Qr, quiet = 4): string {
  let d = "";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.dark[r * qr.size + c]) continue;
      // Merge runs along the row.
      let e = c;
      while (e + 1 < qr.size && qr.dark[r * qr.size + e + 1]) e++;
      d += `M${c + quiet} ${r + quiet}h${e - c + 1}v1h${-(e - c + 1)}z`;
      c = e;
    }
  }
  return d;
}
