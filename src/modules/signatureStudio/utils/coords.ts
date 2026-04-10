/**
 * Coordinate utilities for Signature Studio
 * All storage is in normalized coordinates (0..1)
 * Rendering converts to pixels based on current page size
 */

export function pctToPixels(
  pct: number,
  containerSize: number
): number {
  return pct * containerSize;
}

export function pixelsToPct(
  pixels: number,
  containerSize: number
): number {
  if (containerSize === 0) return 0;
  return pixels / containerSize;
}

export function clampPct(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp a field position to stay within bounds
 */
export function clampFieldPosition(
  xPct: number,
  yPct: number,
  wPct: number,
  hPct: number
): { xPct: number; yPct: number } {
  return {
    xPct: clampPct(xPct, 0, 1 - wPct),
    yPct: clampPct(yPct, 0, 1 - hPct),
  };
}

/**
 * Clamp field size to not exceed page bounds
 */
export function clampFieldSize(
  xPct: number,
  yPct: number,
  wPct: number,
  hPct: number
): { wPct: number; hPct: number } {
  return {
    wPct: clampPct(wPct, 0.05, 1 - xPct),
    hPct: clampPct(hPct, 0.03, 1 - yPct),
  };
}
