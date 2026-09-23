// Rasterise public/icon.svg into the PWA icon set. Needs `rsvg-convert`
// (brew install librsvg). The maskable icon shrinks the art into the 80%
// safe zone on a full-bleed background.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = "public/icon.svg";
const render = (input, size, out) =>
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), input, "-o", out]);

render(src, 192, "public/icon-192.png");
render(src, 512, "public/icon-512.png");
render(src, 180, "public/apple-touch-icon.png");

const inner = readFileSync(src, "utf8").replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1f2126"/>
  <g transform="translate(51.2 51.2) scale(0.8)">${inner}</g>
</svg>`;
const tmp = join(mkdtempSync(join(tmpdir(), "qc1-")), "maskable.svg");
writeFileSync(tmp, maskable);
render(tmp, 512, "public/icon-maskable-512.png");
console.log("icons written");
