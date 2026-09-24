/**
 * Drag and drop with pointer events (phones: HTML5 drag and drop doesn't work
 * on touch). One drag at a time: palette tiles, gates, their control/target
 * dots and the "● +" add-control handle all start one here. The circuit
 * diagram registers a drop zone that maps a screen point to a wire and a
 * column; the dock registers a trash area. A press becomes a drag once the
 * pointer moves a few pixels; a release before that is a tap, and holding
 * still for LONG_PRESS ms is a long-press (the gate's menu).
 */
import { useSyncExternalStore } from "react";
import type { PaletteItem } from "../calc/gateSpecs";

export type DragPayload =
  | { kind: "new"; item: PaletteItem }
  /** An existing gate (tape entry), grabbed on wire `grabRow`. */
  | { kind: "move"; entry: number; grabRow: number }
  /** One of a gate's dots: target or control `index`. */
  | { kind: "dot"; entry: number; role: "target" | "control"; index: number }
  /** The selected gate's "● +" handle: drop on a wire to add a control there. */
  | { kind: "addctl"; entry: number }
  /** A measurement's (write) or an IF step's (read) dot on a classical lane: drop on another lane to change the bit. */
  | { kind: "bit"; entry: number; role: "write" | "read" };

/** Where a point falls on the diagram: a wire (row) and the column it's before. */
export type Spot = { row: number; col: number };
export type Hover = { spot: Spot } | { trash: true } | null;
export type DragState = { payload: DragPayload; label: string; x: number; y: number; hover: Hover };

type Zone = { resolve: (x: number, y: number) => Spot | null };

const THRESHOLD = 6;
export const LONG_PRESS = 450;
let zone: Zone | null = null;
let trash: HTMLElement | null = null;
let current: DragState | null = null;
let dropHandler: ((payload: DragPayload, hover: Hover) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export const setDropZone = (z: Zone | null) => { zone = z; };
export const setTrash = (el: HTMLElement | null) => { trash = el; };
export const setDropHandler = (f: typeof dropHandler) => { dropHandler = f; };

function hoverAt(x: number, y: number): Hover {
  if (trash) {
    const r = trash.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { trash: true };
  }
  const spot = zone?.resolve(x, y) ?? null;
  return spot ? { spot } : null;
}

/**
 * A press on a drag source. It turns into a drag after THRESHOLD px of
 * movement (the source should have `touch-action: none` for the directions
 * it drags in); released earlier, `onTap` runs instead; held still for
 * LONG_PRESS ms, `onLongPress` runs (and the press ends there).
 */
export function pressToDrag(ev: React.PointerEvent | PointerEvent, payload: DragPayload, label: string, onTap?: () => void,
  onLongPress?: (x: number, y: number) => void) {
  if (ev.button !== 0 && ev.pointerType === "mouse") return;
  const x0 = ev.clientX, y0 = ev.clientY, id = ev.pointerId;
  const el = ev.currentTarget as Element | null;
  try { el?.setPointerCapture?.(id); } catch { /* not capturable */ }
  let active = false, held = false;
  const timer = onLongPress ? setTimeout(() => {
    held = true;
    try { navigator.vibrate?.(12); } catch { /* none */ }
    onLongPress(x0, y0);
  }, LONG_PRESS) : undefined;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== id || held) return;
    if (!active) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < THRESHOLD) return;
      clearTimeout(timer);
      active = true;
      try { navigator.vibrate?.(8); } catch { /* none */ }
    }
    e.preventDefault();
    current = { payload, label, x: e.clientX, y: e.clientY, hover: hoverAt(e.clientX, e.clientY) };
    emit();
  };
  const end = (e: PointerEvent, cancelled: boolean) => {
    if (e.pointerId !== id) return;
    clearTimeout(timer);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    if (active) {
      const hover = cancelled ? null : hoverAt(e.clientX, e.clientY);
      current = null;
      emit();
      if (hover) dropHandler?.(payload, hover);
    } else if (!cancelled && !held) onTap?.();
  };
  const up = (e: PointerEvent) => end(e, false);
  const cancel = (e: PointerEvent) => end(e, true);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
/** The drag in progress (null when none): for the ghost, the drop preview and the trash area. */
export function useDrag(): DragState | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
