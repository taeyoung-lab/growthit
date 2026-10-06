export function fmtNum(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "-" : Math.round(n).toLocaleString("ko-KR");
}
export function fmtWon(n: number | null | undefined): string {
  return n == null ? "-" : `${fmtNum(n)}원`;
}
// 큰 금액은 억/만 단위로 줄여 슬라이드 카드에 맞춥니다. 예: 1,435,486,629 → 14.4억, 81,989,980 → 8,199만
export function fmtWonShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return `${Math.round(n).toLocaleString("ko-KR")}`;
}
export function fmtPct(n: number | null | undefined, digits = 1): string {
  return n == null || !Number.isFinite(n) ? "-" : `${n.toFixed(digits)}%`;
}
export function fmtSigned(n: number | null | undefined, unit = "%"): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}${unit}`;
}
export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  return `${y}년 ${Number(m)}월`;
}
export function monthShort(yearMonth: string): string {
  return `${Number(yearMonth.split("-")[1])}월`;
}

