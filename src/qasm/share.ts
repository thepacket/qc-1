/**
 * Share links: the tape travels as its OpenQASM export in the URL fragment
 * (`#q=` base64url of the UTF-8 text), with the symbol values (`&v=`). The
 * fragment never reaches the server; opening the link imports the program
 * like a file (the importer refuses anything but plain arithmetic).
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

export function shareHash(n: number, tape: Entry[], scope: Scope): string {
  const q = b64url(new TextEncoder().encode(exportQasm3(n, tape)));
  const vals = Object.entries(scope).map(([k, v]) => `${k}:${+v.toPrecision(12)}`).join(",");
  return `#q=${q}${vals ? `&v=${encodeURIComponent(vals)}` : ""}`;
}

export function readShareHash(hash: string): { qasm: string; scope: Scope } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const q = params.get("q");
  if (!q) return null;
  let qasm: string;
  try {
    qasm = new TextDecoder("utf-8", { fatal: true }).decode(unb64url(q));
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
