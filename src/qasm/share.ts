/**
 * Share links: the tape travels as its OpenQASM export in the URL fragment,
 * `#z=` base64url of the deflate-raw compressed UTF-8 text (the browser's
 * CompressionStream), with the symbol values (`&v=`). Compression keeps
 * links short enough for a QR code (qr.ts). Links from before it, `#q=`
 * with the uncompressed text, still open. The fragment never reaches the
 * server; opening the link imports the program like a file (the importer
 * refuses anything but plain arithmetic).
 */
import type { Entry, Scope } from "../calc/steps";
import { exportQasm3 } from "./fromTape";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const unb64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Largest program a link may inflate to (a crafted link can't unpack to more). */
const MAX_TEXT = 1 << 20;

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const out = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_TEXT) {
      await reader.cancel();
      throw new Error("link too large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function shareHash(n: number, tape: Entry[], scope: Scope, nc = n): Promise<string> {
  const z = b64url(await deflate(new TextEncoder().encode(exportQasm3(n, tape, nc))));
  const vals = Object.entries(scope).map(([k, v]) => `${k}:${+v.toPrecision(12)}`).join(",");
  return `#z=${z}${vals ? `&v=${encodeURIComponent(vals)}` : ""}`;
}

export async function readShareHash(hash: string): Promise<{ qasm: string; scope: Scope } | null> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const z = params.get("z"), q = params.get("q");
  if (!z && !q) return null;
  let qasm: string;
  try {
    const bytes = z ? await inflate(unb64url(z)) : unb64url(q!);
    qasm = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const scope: Scope = {};
  for (const kv of (params.get("v") ?? "").split(",").filter(Boolean)) {
    const [k, v] = kv.split(":");
    const x = Number(v);
    if (/^[A-Za-z_][\w]*$/.test(k) && !["__proto__", "constructor", "prototype"].includes(k) && Number.isFinite(x)) scope[k] = x;
  }
  return { qasm, scope };
}
