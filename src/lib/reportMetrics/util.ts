
export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
export function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
export function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function pctChange(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return round1(((cur - prev) / Math.abs(prev)) * 100);
}
export function prevMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function monthsBefore(yearMonth: string, n: number): string {
  let ym = yearMonth;
  for (let i = 0; i < n; i++) ym = prevMonth(ym);
  return ym;
}
