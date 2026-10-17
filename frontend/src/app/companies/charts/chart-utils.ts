/** Rounds the range [min, max] to about `count` clean tick values. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) { min -= 1; max += 1; }
  const rawStep = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rawStep)!;
  const ticks: number[] = [];
  // Ticks must enclose [min, max] so the plotted data can never leave the frame.
  const start = Math.floor(min / step + 1e-9) * step;
  for (let v = start; ; v += step) {
    ticks.push(+v.toFixed(10));
    if (v >= max - step * 1e-9) break;
  }
  return ticks;
}

/** Compact axis label: 1.2K, 3.4M, 12.50. */
export function compact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${+(v / 1e3).toFixed(1)}K`;
  return abs >= 100 ? v.toFixed(0) : +v.toFixed(2) + '';
}

/** Full-precision label for a per-share amount: at least 2, at most 3 decimals. */
export function amount(v: number): string {
  const s = v.toFixed(3);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}
