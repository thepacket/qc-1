import type { ReactNode } from "react";
import { Tex } from "./Tex";

/**
 * A tiny Markdown renderer for the AI chat (ported from Quantiom's): headings,
 * paragraphs, fenced code, bullet and numbered lists, pipe tables, rules,
 * LaTeX (block $$…$$ / \[…\], inline $…$ / \(…\)) through KaTeX, and inline
 * `code`, **bold**, *italic*, [links](https://…). Everything is React text:
 * no HTML from the reply is ever inserted, and only http(s) links are live.
 */
function takeDelimited(lines: string[], i: number, open: string, close: string): { content: string; next: number } {
  const s = lines[i].trim().slice(open.length);
  const idx = s.indexOf(close);
  if (idx >= 0) return { content: s.slice(0, idx).trim(), next: i + 1 };
  const buf = [s];
  for (i++; i < lines.length; i++) {
    const ci = lines[i].indexOf(close);
    if (ci >= 0) { buf.push(lines[i].slice(0, ci)); return { content: buf.join("\n").trim(), next: i + 1 }; }
    buf.push(lines[i]);
  }
  return { content: buf.join("\n").trim(), next: i };
}

const LIST = /^\s*(-|\*|\d+\.)\s+/;

export function Markdown({ source }: { source: string }) {
  const out: ReactNode[] = [];
  const lines = source.split("\n");
  let key = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i], trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      const buf: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) buf.push(lines[i]);
      i++;
      out.push(<pre key={key++} className="chat-code">{buf.join("\n")}</pre>);
      continue;
    }
    if (trimmed.startsWith("$$") || trimmed.startsWith("\\[")) {
      const dollar = trimmed.startsWith("$$");
      const { content, next } = takeDelimited(lines, i, dollar ? "$$" : "\\[", dollar ? "$$" : "\\]");
      out.push(<div key={key++} className="md-math"><Tex latex={content} display /></div>);
      i = next;
      continue;
    }
    if (/^-{3,}\s*$/.test(trimmed)) { out.push(<hr key={key++} className="md-rule" />); i++; continue; }
    const h = HEADING.exec(trimmed);
    if (h) { out.push(<div key={key++} className={`md-h md-h${h[1].length}`}>{inline(h[2])}</div>); i++; continue; }
    if (trimmed.startsWith("|")) {
      const tbl: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) tbl.push(lines[i].trim());
      out.push(<Table key={key++} rows={tbl} />);
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      for (; i < lines.length && (LIST.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) {
        if (LIST.test(lines[i])) items.push(lines[i].replace(LIST, ""));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
      }
      const lis = items.map((it, k) => <li key={k}>{inline(it)}</li>);
      out.push(ordered ? <ol key={key++} className="md-list">{lis}</ol> : <ul key={key++} className="md-list">{lis}</ul>);
      continue;
    }
    if (!trimmed) { i++; continue; }
    // QC-1 fix (docs/quantiom-bugs.md #58): a paragraph stops only at a line some branch above
    // will consume (the same tests), and always takes its first line: "#" or "#hashtag" used to
    // stop it without being a heading, so the loop never advanced and the page hung.
    const para: string[] = [line];
    for (i++; i < lines.length && !blockStart(lines[i]); i++) para.push(lines[i]);
    out.push(<p key={key++} className="md-p">{inline(para.join(" "))}</p>);
  }
  return <>{out}</>;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
/** A line that one of the block branches consumes (blank lines included). */
function blockStart(l: string): boolean {
  const t = l.trim();
  return !t || t.startsWith("```") || t.startsWith("$$") || t.startsWith("\\[") || /^-{3,}\s*$/.test(t) || HEADING.test(t) || t.startsWith("|") || LIST.test(l);
}

function Table({ rows }: { rows: string[] }) {
  const cells = rows.map((r) => r.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()));
  const data = cells.filter((row) => !row.every((c) => /^:?-+:?$/.test(c)));
  if (!data.length) return null;
  const [head, ...body] = data;
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead><tr>{head.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr></thead>
        <tbody>{body.map((row, r) => <tr key={r}>{row.map((c, i) => <td key={i}>{inline(c)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** `code` first (so $ * [ inside code stay literal), then math, links, bold, italic. */
function inline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\$\$[^$]+\$\$)|(\\\([\s\S]*?\\\))|(\$[^$\n]+\$)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)/g;
  let cursor = 0, k = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text));) {
    if (m.index > cursor) nodes.push(text.slice(cursor, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) nodes.push(<code key={k++} className="md-code">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("$$")) nodes.push(<Tex key={k++} latex={tok.slice(2, -2).trim()} display />);
    else if (tok.startsWith("\\(")) nodes.push(<Tex key={k++} latex={tok.slice(2, -2).trim()} />);
    else if (tok.startsWith("$")) nodes.push(<Tex key={k++} latex={tok.slice(1, -1).trim()} />);
    else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      nodes.push(/^https?:\/\//.test(mm[2])
        ? <a key={k++} href={mm[2]} target="_blank" rel="noreferrer noopener">{mm[1]}</a>
        : <span key={k++}>{mm[1]}</span>);
    } else if (tok.startsWith("**")) nodes.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else nodes.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    cursor = m.index + tok.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
