/**
 * Video of a t-sweep: one full period of t (0 → 2π) played through the
 * display and recorded as WebM (MP4 where the browser records only that,
 * e.g. Safari). Each frame waits for the core's view of that t, is drawn by
 * the SVG exporter onto a canvas, and is handed to MediaRecorder on a fixed
 * clock, so the video plays at `fps` whatever the frame cost. t is restored
 * afterwards.
 */
import type { Calculator } from "../calc/calculator";
import { elementToSvg, saveFile } from "./svgExport";

const TAU = 2 * Math.PI;

/** A container/codec the browser can record, or null. */
export function videoType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [["video/webm;codecs=vp9", "webm"], ["video/webm;codecs=vp8", "webm"], ["video/webm", "webm"], ["video/mp4", "mp4"]] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

const frameDone = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

async function rasterize(el: HTMLElement, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const svg = elementToSvg(el);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  ctx.fillStyle = "#1a1a19";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
}

export async function recordSweep(calc: Calculator, frames = 120, fps = 24): Promise<void> {
  const type = videoType();
  if (!type) throw new Error("this browser can't record video");
  const el = document.querySelector<HTMLElement>(".lcd");
  if (!el) throw new Error("no display");
  if (calc.playback) calc.stopPlayback();
  const t0 = calc.scope.t ?? 0;
  const box = el.getBoundingClientRect();
  const scale = Math.min(2, 1280 / box.width);
  const W = Math.round((box.width * scale) / 2) * 2, H = Math.round((box.height * scale) / 2) * 2; // even: encoders want it
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const rec = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  // The first frame must exist before recording starts.
  calc.setSymbol("t", 0);
  await calc.nextView();
  await frameDone();
  await rasterize(el, ctx, W, H);
  rec.start();
  const start = performance.now();
  try {
    for (let k = 0; k < frames; k++) {
      calc.setRecording({ frame: k, frames });
      if (k > 0) {
        calc.setSymbol("t", (TAU * k) / frames);
        await calc.nextView();
        await frameDone();
        await rasterize(el, ctx, W, H);
      }
      // Hold each frame until its slot on the clock, then hand it over.
      const due = start + (k * 1000) / fps;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      track.requestFrame();
    }
    await new Promise((r) => setTimeout(r, 1000 / fps));
  } finally {
    rec.stop();
    await stopped;
    calc.setRecording(null);
    calc.setSymbol("t", t0);
  }
  const blob = new Blob(chunks, { type: type.mime.split(";")[0] });
  await saveFile(new File([blob], `qc1-sweep.${type.ext}`, { type: blob.type }));
}
