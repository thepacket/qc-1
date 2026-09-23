import { useState, type ReactNode } from "react";
import type { Chart } from "../../analysis/types";
import { divColor, fmt, fmtC, phaseColor, seqColor } from "./colors";
import { project } from "./sphere";

/** Tap-to-read line shown under a chart (phones have no hover). */
function Readout({ text, hint }: { text: string | null; hint: string }) {
  return <div className="readout">{text ?? hint}</div>;
}

function Frame({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <figure className="chart">
      {title && <figcaption>{title}</figcaption>}
      {children}
    </figure>
  );
}

// ─── Heatmap ─────────────────────────────────────────────────────────
function Heatmap({ c }: { c: Extract<Chart, { kind: "heatmap" }> }) {
  const [pick, setPick] = useState<string | null>(null);
  const R = c.rows.length, C = c.cols.length;
  const cell = 100 / Math.max(R, C);
  const mags = c.values.map((row, i) => row.map((v, j) => (c.scale === "complex" ? Math.hypot(v, c.imag?.[i][j] ?? 0) : v)));
  const lo = c.min ?? (c.scale === "div" ? -Math.max(...mags.flat().map(Math.abs), 1e-12) : 0);
  const hi = c.max ?? Math.max(...mags.flat().map(Math.abs), 1e-12);
  const showText = C <= 6;
  const color = (i: number, j: number) => {
    const v = c.values[i][j];
    if (c.scale === "seq") return seqColor((v - lo) / (hi - lo || 1));
    if (c.scale === "div") return divColor(v / Math.max(Math.abs(lo), Math.abs(hi), 1e-12));
    return phaseColor(Math.atan2(c.imag?.[i][j] ?? 0, v));
  };
  const label = (i: number, j: number) =>
    c.scale === "complex" ? fmtC(c.values[i][j], c.imag?.[i][j] ?? 0) : fmt(c.values[i][j]);
  return (
    <Frame title={c.title}>
      <div className="heat">
        <div className="heat-cols" style={{ gridTemplateColumns: `2.6em repeat(${C}, 1fr)` }}>
          <span />
          {c.cols.map((l, j) => <span key={`${l}${j}`}>{C <= 8 || j % Math.ceil(C / 8) === 0 ? l : ""}</span>)}
        </div>
        <div className="heat-body">
          <div className="heat-rows">
            {c.rows.map((l, i) => <span key={`${l}${i}`} style={{ height: `${cell}%` }}>{R <= 16 || i % Math.ceil(R / 16) === 0 ? l : ""}</span>)}
          </div>
          <svg viewBox={`0 0 ${C * cell} ${R * cell}`} className="heat-svg" preserveAspectRatio="none" role="img" aria-label={c.title ?? "heatmap"}>
            {c.values.map((row, i) =>
              row.map((_, j) => {
                const m = mags[i][j] / (hi || 1);
                const op = c.scale === "complex" ? (m < 1e-9 ? 0 : 0.15 + 0.85 * Math.min(1, m)) : 1;
                return (
                  <g key={`${i}-${j}`} onClick={() => setPick(`${c.rows[i]}, ${c.cols[j]}: ${label(i, j)}${c.unit ? ` ${c.unit}` : ""}`)}>
                    <rect x={j * cell + 0.4} y={i * cell + 0.4} width={cell - 0.8} height={cell - 0.8} rx={0.8}
                      fill={c.scale === "complex" && m < 1e-9 ? "#232322" : color(i, j)} fillOpacity={op} />
                    {showText && (
                      <text x={(j + 0.5) * cell} y={(i + 0.5) * cell} className="heat-text" fontSize={cell * 0.2}>
                        {c.scale === "complex" ? fmt(Math.hypot(c.values[i][j], c.imag?.[i][j] ?? 0), 2) : fmt(c.values[i][j], 2)}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </svg>
        </div>
        <div className="heat-legend">
          {c.scale === "complex" ? (
            <span>colour = phase · opacity = |value| (max {fmt(hi)})</span>
          ) : (
            <>
              <span>{fmt(lo)}</span>
              <span className="grad" style={{
                background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => (c.scale === "seq" ? seqColor(t) : divColor(2 * t - 1))).join(",")})`,
              }} />
              <span>{fmt(hi)}{c.unit ? ` ${c.unit}` : ""}</span>
            </>
          )}
        </div>
      </div>
      <Readout text={pick} hint="tap a cell for its value" />
    </Frame>
  );
}

// ─── Bars (horizontal) ───────────────────────────────────────────────
function Bars({ c }: { c: Extract<Chart, { kind: "bars" }> }) {
  const max = c.max ?? Math.max(...c.values.map(Math.abs), 1e-12);
  return (
    <Frame title={c.title}>
      <div className="hbars">
        {c.labels.map((l, i) => {
          const v = c.values[i];
          const ph = c.phases?.[i];
          return (
            <div className="hbar" key={`${l}${i}`}>
              <span className="lbl">{l}</span>
              <span className="track">
                <span style={{
                  width: `${(Math.abs(v) / max) * 100}%`,
                  background: ph !== undefined ? phaseColor(ph) : c.signed && v < 0 ? "var(--series-2)" : undefined,
                }} />
              </span>
              <span className="val">
                {fmt(v)}
                {ph !== undefined && ` ∠${Math.round((ph * 180) / Math.PI)}°`}
              </span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

// ─── Lines ───────────────────────────────────────────────────────────
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

function Lines({ c }: { c: Extract<Chart, { kind: "lines" }> }) {
  const [pick, setPick] = useState<number | null>(null);
  const W = 300, H = 170, L = 34, B = 26, T = 8, Rm = 8;
  const xs = c.x;
  const all = c.series.flatMap((s) => s.y).filter(Number.isFinite);
  const y0 = c.yMin ?? Math.min(...all, 0);
  const y1 = c.yMax ?? Math.max(...all, y0 + 1e-9);
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1e-9);
  const px = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - Rm);
  const py = (y: number) => T + (1 - (y - y0) / (y1 - y0 || 1)) * (H - T - B);
  const yTicks = [0, 0.5, 1].map((t) => y0 + t * (y1 - y0));
  const tickEvery = Math.max(1, Math.ceil(xs.length / 7));
  return (
    <Frame title={c.title}>
      <svg viewBox={`0 0 ${W} ${H}`} className="lines-svg" role="img" aria-label={c.title ?? c.yLabel}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - Rm} y1={py(t)} y2={py(t)} className="grid" />
            <text x={L - 4} y={py(t)} className="tick" textAnchor="end" dominantBaseline="middle">{fmt(t, 2)}</text>
          </g>
        ))}
        {xs.map((x, i) =>
          i % tickEvery === 0 ? (
            <text key={i} x={px(x)} y={H - B + 12} className="tick" textAnchor="middle">{c.xTicks?.[i] ?? fmt(x, 2)}</text>
          ) : null,
        )}
        <text x={W - Rm} y={H - 2} className="axis-name" textAnchor="end">{c.xLabel}</text>
        {c.series.map((s, k) => {
          const pts = xs.map((x, i) => (Number.isFinite(s.y[i]) ? `${px(x)},${py(s.y[i])}` : null)).filter(Boolean);
          return (
            <g key={s.name}>
              <polyline points={pts.join(" ")} fill="none" stroke={SERIES[k % 3]} strokeWidth={2}
                strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" />
              {!s.dashed && xs.map((x, i) => Number.isFinite(s.y[i]) && (
                <circle key={i} cx={px(x)} cy={py(s.y[i])} r={2.5} fill={SERIES[k % 3]} stroke="var(--lcd)" strokeWidth={1} />
              ))}
            </g>
          );
        })}
        {pick !== null && <line x1={px(xs[pick])} x2={px(xs[pick])} y1={T} y2={H - B} className="crosshair" />}
        {xs.map((x, i) => (
          <rect key={i} x={px(x) - (W - L) / xs.length / 2} y={T} width={(W - L) / xs.length} height={H - T - B}
            fill="transparent" onClick={() => setPick(i)} />
        ))}
      </svg>
      {c.series.length > 1 && (
        <div className="legend">
          {c.series.map((s, k) => (
            <span key={s.name}><i style={{ borderColor: SERIES[k % 3], borderStyle: s.dashed ? "dashed" : "solid" }} />{s.name}</span>
          ))}
        </div>
      )}
      <Readout
        text={pick === null ? null : `${c.xLabel} ${c.xTicks?.[pick] ?? fmt(xs[pick])}: ${c.series.map((s) => `${s.name} ${fmt(s.y[pick])}`).join(" · ")}`}
        hint={`${c.yLabel} · tap for values`}
      />
    </Frame>
  );
}

// ─── Table ───────────────────────────────────────────────────────────
function Table({ c }: { c: Extract<Chart, { kind: "table" }> }) {
  return (
    <Frame title={c.title}>
      <table className="dtable">
        <thead><tr>{c.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {c.rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j}>{typeof v === "number" ? fmt(v) : v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

// ─── Phase disks ─────────────────────────────────────────────────────
function Disks({ c }: { c: Extract<Chart, { kind: "disks" }> }) {
  const R = 30, S = 76, m = S / 2;
  return (
    <Frame title={c.title}>
      <div className="disks">
        {c.disks.map((d) => {
          const len = Math.hypot(d.re, d.im);
          const tx = m + (d.re / 0.5) * R, ty = m - (d.im / 0.5) * R;
          return (
            <div className="disk" key={d.label}>
              <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`${d.label} ρ₁₀ ${fmtC(d.re, d.im)}`}>
                <circle cx={m} cy={m} r={R} className="disk-ring" />
                <line x1={m - R} x2={m + R} y1={m} y2={m} className="disk-axis" />
                <line x1={m} x2={m} y1={m - R} y2={m + R} className="disk-axis" />
                {len > 1e-4 && <line x1={m} y1={m} x2={tx} y2={ty} className="disk-needle" />}
                <circle cx={tx} cy={ty} r={3} className="disk-tip" />
              </svg>
              <span>{d.label}</span>
              <span className="dim">{len > 1e-4 ? `${fmt(len * 2, 2)} ∠${Math.round((Math.atan2(d.im, d.re) * 180) / Math.PI)}°` : "no coherence"}</span>
            </div>
          );
        })}
      </div>
      <div className="readout">needle = ρ₁₀ (angle: relative phase; length: 2|ρ₁₀|, 1 = pure superposition)</div>
    </Frame>
  );
}

// ─── Q-sphere ────────────────────────────────────────────────────────
function QSphere({ c }: { c: Extract<Chart, { kind: "qsphere" }> }) {
  const [pick, setPick] = useState<string | null>(null);
  const R = 80, S = 200, m = S / 2;
  const pts = c.points
    .map((p) => {
      const [sx, sy, d] = project(p.x, p.y, p.z);
      return { ...p, sx: m + sx * R, sy: m - sy * R, d };
    })
    .sort((a, b) => a.d - b.d);
  return (
    <Frame title={c.title}>
      <svg viewBox={`0 0 ${S} ${S}`} className="qsphere" role="img" aria-label="Q-sphere">
        <circle cx={m} cy={m} r={R} className="sphere" />
        <ellipse cx={m} cy={m} rx={R} ry={R * 0.26} className="eq back" />
        {pts.map((p) => (
          <g key={p.label} onClick={() => setPick(`${p.label}: |a| ${fmt(p.mag)} ∠${Math.round((p.phase * 180) / Math.PI)}°`)}>
            <line x1={m} y1={m} x2={p.sx} y2={p.sy} stroke={phaseColor(p.phase)} strokeOpacity={0.35} strokeWidth={1} />
            <circle cx={p.sx} cy={p.sy} r={3 + 11 * p.mag} fill={phaseColor(p.phase)}
              fillOpacity={p.d < 0 ? 0.55 : 1} stroke="var(--lcd)" strokeWidth={1.5} />
          </g>
        ))}
      </svg>
      <Readout text={pick} hint="north pole |0…0⟩ · latitude = Hamming weight · size = |a| · colour = phase" />
    </Frame>
  );
}

// ─── Scatter (+ fit) ─────────────────────────────────────────────────
function Scatter({ c }: { c: Extract<Chart, { kind: "scatter" }> }) {
  const [pick, setPick] = useState<string | null>(null);
  const W = 300, H = 160, L = 38, B = 26, T = 8, Rm = 8;
  const x0 = Math.min(...c.x), x1 = Math.max(...c.x, x0 + 1e-9);
  const ys = [...c.y, ...(c.fit ? [c.fit.a + c.fit.b * x0, c.fit.a + c.fit.b * x1] : [])];
  const y0 = Math.min(...ys), y1 = Math.max(...ys, y0 + 1e-9);
  const px = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - Rm);
  const py = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  return (
    <Frame title={c.title}>
      <svg viewBox={`0 0 ${W} ${H}`} className="lines-svg" role="img" aria-label={c.yLabel}>
        {[0, 0.5, 1].map((t) => {
          const v = y0 + t * (y1 - y0);
          return (
            <g key={t}>
              <line x1={L} x2={W - Rm} y1={py(v)} y2={py(v)} className="grid" />
              <text x={L - 4} y={py(v)} className="tick" textAnchor="end" dominantBaseline="middle">{fmt(v, 2)}</text>
            </g>
          );
        })}
        {c.x.map((x, i) => <text key={i} x={px(x)} y={H - B + 12} className="tick" textAnchor="middle">{fmt(x, 2)}</text>)}
        <text x={W - Rm} y={H - 2} className="axis-name" textAnchor="end">{c.xLabel}</text>
        {c.fit && (
          <line x1={px(x0)} y1={py(c.fit.a + c.fit.b * x0)} x2={px(x1)} y2={py(c.fit.a + c.fit.b * x1)}
            stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" />
        )}
        {c.x.map((x, i) => (
          <circle key={i} cx={px(x)} cy={py(c.y[i])} r={4} fill="var(--series-1)" stroke="var(--lcd)" strokeWidth={1.5}
            onClick={() => setPick(`${c.xLabel} ${fmt(x)}: ${c.yLabel} ${fmt(c.y[i])}`)} />
        ))}
      </svg>
      {c.fit && <div className="legend"><span><i style={{ borderColor: "var(--series-1)" }} />data</span><span><i style={{ borderColor: "var(--series-2)", borderStyle: "dashed" }} />fit · {c.fit.label}</span></div>}
      <Readout text={pick} hint={`${c.yLabel} · tap a point`} />
    </Frame>
  );
}

// ─── Histogram (+ reference curve) ──────────────────────────────────
function Hist({ c }: { c: Extract<Chart, { kind: "hist" }> }) {
  const [pick, setPick] = useState<number | null>(null);
  const W = 300, H = 150, L = 34, B = 24, T = 8, Rm = 8;
  const n = c.centers.length;
  const w = (W - L - Rm) / n;
  const top = Math.max(...c.values, ...(c.curve?.y ?? []), 1e-9);
  const py = (y: number) => T + (1 - y / top) * (H - T - B);
  return (
    <Frame title={c.title}>
      <svg viewBox={`0 0 ${W} ${H}`} className="lines-svg" role="img" aria-label={c.yLabel}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - Rm} y1={py(t * top)} y2={py(t * top)} className="grid" />
            <text x={L - 4} y={py(t * top)} className="tick" textAnchor="end" dominantBaseline="middle">{fmt(t * top, 2)}</text>
          </g>
        ))}
        {c.values.map((v, i) => (
          <rect key={i} x={L + i * w + 1} y={py(v)} width={w - 2} height={Math.max(0, H - B - py(v))} rx={1.5}
            fill="var(--series-1)" onClick={() => setPick(i)} />
        ))}
        {c.curve && (
          <polyline points={c.curve.y.map((y, i) => `${L + (i + 0.5) * w},${py(y)}`).join(" ")} fill="none"
            stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" />
        )}
        {c.centers.map((x, i) => (i % Math.ceil(n / 6) === 0 ? (
          <text key={i} x={L + (i + 0.5) * w} y={H - B + 12} className="tick" textAnchor="middle">{fmt(x, 2)}</text>
        ) : null))}
        <text x={W - Rm} y={H - 2} className="axis-name" textAnchor="end">{c.xLabel}</text>
      </svg>
      {c.curve && <div className="legend"><span><i style={{ borderColor: "var(--series-1)" }} />observed</span><span><i style={{ borderColor: "var(--series-2)", borderStyle: "dashed" }} />{c.curve.name}</span></div>}
      <Readout text={pick === null ? null : `${c.xLabel} ≈ ${fmt(c.centers[pick])}: ${fmt(c.values[pick])}${c.curve ? ` (${c.curve.name} ${fmt(c.curve.y[pick])})` : ""}`}
        hint={`${c.yLabel} · tap a bar`} />
    </Frame>
  );
}

// ─── Majorana stars ─────────────────────────────────────────────────
function Stars({ c }: { c: Extract<Chart, { kind: "stars" }> }) {
  const [pick, setPick] = useState<string | null>(null);
  const R = 80, S = 200, m = S / 2;
  const pts = c.stars
    .map((s, i) => {
      const [sx, sy, d] = project(Math.sin(s.theta) * Math.cos(s.phi), Math.sin(s.theta) * Math.sin(s.phi), Math.cos(s.theta));
      return { i, s, sx: m + sx * R, sy: m - sy * R, d };
    })
    .sort((a, b) => a.d - b.d);
  return (
    <Frame title={c.title}>
      <svg viewBox={`0 0 ${S} ${S}`} className="qsphere" role="img" aria-label="Majorana stars">
        <circle cx={m} cy={m} r={R} className="sphere" />
        <ellipse cx={m} cy={m} rx={R} ry={R * 0.26} className="eq back" />
        <text x={m} y={m - R - 6} className="axis-label">|0…0⟩</text>
        {pts.map((p) => (
          <g key={p.i} onClick={() => setPick(`star ${p.i + 1}: θ ${Math.round((p.s.theta * 180) / Math.PI)}°, φ ${Math.round((p.s.phi * 180) / Math.PI)}°`)}>
            <circle cx={p.sx} cy={p.sy} r={6} fill="var(--series-2)" fillOpacity={p.d < 0 ? 0.5 : 1} stroke="var(--lcd)" strokeWidth={1.5} />
          </g>
        ))}
      </svg>
      <Readout text={pick} hint={`${c.stars.length} stars · tap one`} />
    </Frame>
  );
}

export function ChartView({ chart }: { chart: Chart }) {
  switch (chart.kind) {
    case "heatmap": return <Heatmap c={chart} />;
    case "bars": return <Bars c={chart} />;
    case "lines": return <Lines c={chart} />;
    case "table": return <Table c={chart} />;
    case "disks": return <Disks c={chart} />;
    case "qsphere": return <QSphere c={chart} />;
    case "scatter": return <Scatter c={chart} />;
    case "hist": return <Hist c={chart} />;
    case "stars": return <Stars c={chart} />;
  }
}
