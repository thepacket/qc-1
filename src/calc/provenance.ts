import type { ViewData } from "./core";

export type Provenance = { method: string; detail: string };

/** Describe the data that actually produced a result, rather than current UI settings. */
export function viewProvenance(data: ViewData, source: string, detail = ""): Provenance {
  const e = data.estimate;
  if (e?.settings) return { method: "State tomography", detail: `${e.settings} settings × ${e.shots.toLocaleString()} shots · leading component, weight ${e.lambda?.toFixed(3)} · ${source}${detail ? ` · ${detail}` : ""}` };
  if (e || data.mode === "shots") {
    const shots = e?.shots ?? (data.mode === "shots" ? data.shots : 0);
    return { method: "Sampled measurements", detail: `${shots.toLocaleString()} shots${data.mode === "bloch" ? " per X/Y/Z setting" : ""} · ${source}${detail ? ` · ${detail}` : ""}${e?.magnitudes ? " · phases not measured" : ""}` };
  }
  return { method: source, detail: detail || "Calculated directly; no shot uncertainty." };
}
