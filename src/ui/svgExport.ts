/**
 * SVG export of what's on screen: a chart's figure or the circuit diagram,
 * as a standalone vector file. The browser has already laid everything out,
 * so the figure is walked as rendered: nested <svg> keep their shapes, with
 * computed styles inlined (no stylesheet travels with the file); HTML text
 * becomes <text>, HTML boxes with a background or border become <rect>.
 * Colours are the display's (dark surface), where they are validated.
 */

const SVG_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "stroke-opacity",
  "opacity", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline", "visibility",
] as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const transparent = (c: string) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);

/** A copy of an <svg> with every element's computed presentation inlined. */
function inlineSvg(svg: SVGSVGElement): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll("*")], dst = [copy, ...copy.querySelectorAll("*")];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const out = dst[i] as SVGElement;
    out.removeAttribute("class");
    out.setAttribute("style", SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
  });
  return copy;
}

/** The first non-transparent background at or above `el`. */
function backgroundOf(el: Element | null): string {
  for (; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    if (!transparent(c)) return c;
  }
  return "#1a1a19";
}

/**
 * The element as an SVG document. `full` names nested <svg>s to draw at their
 * whole size rather than the scrolled, visible part (the circuit diagram).
 */
export function elementToSvg(root: HTMLElement, full?: SVGSVGElement[]): string {
  const base = root.getBoundingClientRect();
  const parts: string[] = [];
  let extraW = 0;
  // The drawn extent: the file is cropped to it (a pane can be taller than its content).
  let maxX = 0, maxY = 0;
  const grow = (x: number, y: number) => { maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.replace(/\s+/g, " ").trim();
      const parent = node.parentElement;
      if (!text || !parent) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (!range.getBoundingClientRect().width) return;
      const cs = getComputedStyle(parent);
      const style = `fill:${cs.color};font-size:${cs.fontSize};font-family:${esc(cs.fontFamily)};font-weight:${cs.fontWeight}`;
      // One <text> per rendered line: a label that wraps on screen wraps in the file too.
      const raw = node.textContent ?? "";
      const lines: { text: string; r: DOMRect }[] = [];
      for (const m of raw.matchAll(/\S+/g)) {
        const w = document.createRange();
        w.setStart(node, m.index!);
        w.setEnd(node, m.index! + m[0].length);
        const r = w.getBoundingClientRect();
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.r.top - r.top) < r.height / 2) {
          last.text += ` ${m[0]}`;
          last.r = new DOMRect(last.r.left, last.r.top, r.right - last.r.left, Math.max(last.r.height, r.height));
        } else lines.push({ text: m[0], r });
      }
      for (const { text: t, r } of lines) {
        grow(r.right - base.left, r.bottom - base.top);
        parts.push(`<text x="${(r.left - base.left).toFixed(1)}" y="${(r.top - base.top + r.height * 0.78).toFixed(1)}" style="${style}">${esc(t)}</text>`);
      }
      return;
    }
    if (!(node instanceof Element)) return;
    const cs = getComputedStyle(node);
    if (cs.display === "none" || cs.visibility === "hidden" || node.tagName === "BUTTON") return;
    const r = node.getBoundingClientRect();
    if (node instanceof SVGSVGElement) {
      const whole = full?.includes(node);
      const w = whole ? Number(node.getAttribute("width")) || r.width : r.width;
      const h = whole ? Number(node.getAttribute("height")) || r.height : r.height;
      // A whole (scrolled) diagram starts where its scroll container does.
      const x = (whole ? node.parentElement!.getBoundingClientRect().left : r.left) - base.left;
      if (whole) extraW = Math.max(extraW, x + w - base.width);
      grow(x + w, r.top - base.top + h);
      const copy = inlineSvg(node);
      copy.setAttribute("x", x.toFixed(1));
      copy.setAttribute("y", (r.top - base.top).toFixed(1));
      copy.setAttribute("width", w.toFixed(1));
      copy.setAttribute("height", h.toFixed(1));
      parts.push(new XMLSerializer().serializeToString(copy));
      return;
    }
    if (node !== root && r.width && r.height) {
      const bg = cs.backgroundColor, bw = parseFloat(cs.borderTopWidth) || 0;
      if (!transparent(bg) || (bw > 0 && cs.borderTopStyle !== "none" && !transparent(cs.borderTopColor))) {
        grow(r.right - base.left, r.bottom - base.top);
        parts.push(`<rect x="${(r.left - base.left).toFixed(1)}" y="${(r.top - base.top).toFixed(1)}" width="${r.width.toFixed(1)}" height="${r.height.toFixed(1)}" rx="${parseFloat(cs.borderTopLeftRadius) || 0}" style="fill:${transparent(bg) ? "none" : bg};stroke:${bw ? cs.borderTopColor : "none"};stroke-width:${bw};stroke-dasharray:${cs.borderTopStyle === "dashed" ? "3 2" : "none"}"/>`);
      }
    }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  const W = Math.ceil(Math.min(base.width + extraW, maxX + 6)), H = Math.ceil(Math.min(base.height, maxY + 6));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="100%" height="100%" style="fill:${backgroundOf(root)}"/>${parts.join("")}</svg>\n`;
}

/** Save an SVG document: the share sheet where there is one (phones), else a download. */
export async function saveSvg(svg: string, name: string): Promise<void> {
  const file = new File([svg], name, { type: "image/svg+xml" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
