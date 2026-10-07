// 웹 리포트(HTML 한 장) — 팀 월간 리포트 포맷(요약 → 핵심 지표 → 주목할 변화+액션 → 지난 제안 추적 → 데이터 기준)을
// 그로스잇 수집 데이터로 만듭니다. 서버에서 문자열로 완성해 .html 파일로 내려주므로 받은 사람은 파일만 열면 됩니다.
// 1단계 범위: CMS 집계값으로 계산 가능한 지표만 씁니다(주문 원본이 필요한 지표는 만들지 않고 "다음 단계"로 안내).

import type { MonthSnapshot, ReportInput, ReportModel } from "@/lib/reportMetrics/types";
import { monthLabel } from "@/lib/reportMetrics/format";
import { snapshotFromData } from "@/lib/reportMetrics/snapshot";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const nf = (n: number) => Math.round(n).toLocaleString("ko-KR");
const daysIn = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const std = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
// 1억 1,213만원 / 3,363만원 / 4,299원
function won(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e8) {
    const eok = Math.floor(a / 1e8);
    const man = Math.round((a % 1e8) / 1e4);
    return `${n < 0 ? "-" : ""}${eok}억${man > 0 ? ` ${nf(man)}만원` : "원"}`;
  }
  if (a >= 1e4) return `${n < 0 ? "-" : ""}${nf(a / 1e4)}만원`;
  return `${nf(n)}원`;
}
const pctStr = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
const ppStr = (v: number, d = 1) => `${v > 0 ? "+" : ""}${v.toFixed(d)}%p`;

// ── 월별 지표(스냅샷 → 값) ─────────────────────────────────────────────────
type MetricKey = "appPayDay" | "appOrdersDay" | "ticket" | "newMembersDay" | "appShare";
interface MetricDef {
  key: MetricKey;
  name: string;
  domain: string;
  mode: "growth" | "level"; // growth: 전월 대비 증감률을 평소와 비교, level: 수준 자체를 비교
  value: (s: MonthSnapshot) => number | null;
}
const METRICS: MetricDef[] = [
  { key: "appPayDay", name: "일평균 앱결제액 성장률", domain: "sales", mode: "growth", value: (s) => (s.appPay != null ? s.appPay / daysIn(s.yearMonth) : null) },
  { key: "appOrdersDay", name: "일평균 앱 주문수 성장률", domain: "sales", mode: "growth", value: (s) => (s.appOrders != null ? s.appOrders / daysIn(s.yearMonth) : null) },
  { key: "ticket", name: "객단가", domain: "ticket", mode: "level", value: (s) => (s.appPay != null && s.appOrders ? s.appPay / s.appOrders : null) },
  { key: "newMembersDay", name: "일평균 신규 가입회원 증감률", domain: "member", mode: "growth", value: (s) => (s.newMembers != null ? s.newMembers / daysIn(s.yearMonth) : null) },
  { key: "appShare", name: "앱 비중", domain: "share", mode: "level", value: (s) => s.appShare },
];

interface Insight {
  key: MetricKey;
  name: string;
  domain: string;
  cur: string;
  base: string;
  delta: string;
  down: boolean;
  z: number;
  n: number; // 평소 값 산출에 쓴 개월 수
  facts: string[];
  title: string;
  how: string;
  kpi: string;
  rawCur: number; // 추적용 — 제안 시점 값
}

// idx번째 달(snaps[idx])을 기준으로 지표를 평가합니다. 평소 값은 그 이전 달들만 씁니다.
function evalMetric(m: MetricDef, snaps: MonthSnapshot[], idx: number): { cur: number; base: number; sd: number; z: number; n: number } | null {
  const vals = snaps.slice(0, idx + 1).map((s) => m.value(s));
  if (vals[idx] == null) return null;
  if (m.mode === "level") {
    const prior = vals.slice(0, idx).filter((v): v is number => v != null).slice(-3);
    if (prior.length < 2) return null;
    const base = mean(prior);
    const sd = Math.max(std(prior), Math.abs(base) * 0.01);
    return { cur: vals[idx]!, base, sd, z: (vals[idx]! - base) / sd, n: prior.length };
  }
  const g: number[] = [];
  for (let i = 1; i <= idx; i++) {
    const a = vals[i - 1];
    const b = vals[i];
    g.push(a != null && b != null && a > 0 ? ((b / a) - 1) * 100 : NaN);
  }
  const cur = g[g.length - 1];
  const prior = g.slice(0, -1).filter((v) => Number.isFinite(v)).slice(-3);
  if (!Number.isFinite(cur) || prior.length < 2) return null;
  const base = mean(prior);
  const sd = Math.max(std(prior), 1); // 최소 1%p — 변동이 거의 없을 때 z가 폭주하지 않도록
  return { cur, base, sd, z: (cur - base) / sd, n: prior.length };
}

function buildInsight(m: MetricDef, e: NonNullable<ReturnType<typeof evalMetric>>, snaps: MonthSnapshot[], idx: number): Insight {
  const s = snaps[idx];
  const p = snaps[idx - 1];
  const up = e.z >= 0;
  const facts: string[] = [];
  let cur = "";
  let base = "";
  let delta = "";
  let title = "";
  let how = "";
  let kpi = "";
  const curTxt = (v: number) => (m.mode === "growth" ? pctStr(v) : m.key === "ticket" ? `${nf(v)}원` : `${v.toFixed(2)}%`);
  cur = curTxt(e.cur);
  base = curTxt(e.base);
  delta = m.mode === "growth" ? ppStr(e.cur - e.base) : m.key === "ticket" ? `${e.cur - e.base > 0 ? "+" : ""}${nf(e.cur - e.base)}원` : ppStr(e.cur - e.base, 2);
  if (m.key === "appPayDay") {
    const c = m.value(s)!;
    const pv = m.value(p);
    facts.push(`일평균 앱결제액 ${won(c)}${pv != null ? ` (전월 ${won(pv)})` : ""}, 월 합계 ${won(s.appPay!)}`, `전월 대비 ${pctStr(e.cur)} — 최근 ${e.n}개월 평균 ${pctStr(e.base)}`);
    title = up ? "성장 가속 구간: 증가분이 나온 매장·메뉴 확인" : "성장 둔화 대응: 매장별 성장률 공유";
    how = up ? "매장별 앱결제액 증감 상위·하위 매장을 뽑아 운영 사례를 정리해 확산 (매장별 집계는 다음 단계 데이터)" : "매장별 전월 대비 성장률 랭킹을 점주에게 공유 → 상위 매장의 앱 안내·쿠폰 운영 방식 확산";
    kpi = `다음 달 일평균 앱결제액 성장률 (이번 달 ${pctStr(e.cur)})`;
  } else if (m.key === "appOrdersDay") {
    const c = m.value(s)!;
    const pv = m.value(p);
    facts.push(`일평균 앱 주문 ${nf(c)}건${pv != null ? ` (전월 ${nf(pv)}건)` : ""}`, `전월 대비 ${pctStr(e.cur)} — 최근 ${e.n}개월 평균 ${pctStr(e.base)}`);
    title = up ? "주문 증가세 유지: 피크 시간대 안정 운영 점검" : "주문 증가세 둔화: 재방문 유도 점검";
    how = up ? "주문이 몰리는 시간대·매장의 조리·픽업 지연 여부를 점검" : "최근 1회 구매 후 미복귀 회원 대상 리마인드 푸시·쿠폰 테스트 (회원 단위 집계는 다음 단계 데이터)";
    kpi = `다음 달 일평균 앱 주문 성장률 (이번 달 ${pctStr(e.cur)})`;
  } else if (m.key === "ticket") {
    const pv = m.value(p);
    facts.push(`객단가 ${nf(e.cur)}원${pv != null ? ` (전월 ${nf(pv)}원)` : ""}`, `최근 ${e.n}개월 평균 ${nf(e.base)}원 대비 ${e.cur - e.base > 0 ? "+" : ""}${nf(e.cur - e.base)}원`);
    title = up ? "객단가 상승 유지: 상승 요인(대용량·푸드) 확인" : "객단가 하락 대응: 대용량·푸드 세트 노출 점검";
    how = up ? "주문 단가가 오른 메뉴 구성(대용량·푸드 추가)을 확인해 앱 상단 노출에 반영 (메뉴별 수량은 다음 단계 데이터)" : "앱 메인·주문 완료 화면에 대용량 옵션·푸드 추가 제안을 노출하고 객단가 변화를 비교";
    kpi = `다음 달 객단가 (이번 달 ${nf(e.cur)}원)`;
  } else if (m.key === "newMembersDay") {
    const c = m.value(s)!;
    const pv = m.value(p);
    facts.push(`일평균 신규 가입회원 ${nf(c)}명${pv != null ? ` (전월 ${nf(pv)}명)` : ""}`, `전월 대비 ${pctStr(e.cur)} — 최근 ${e.n}개월 평균 ${pctStr(e.base)}`);
    title = up ? "신규 유입 상위 매장 사례를 하위 매장에 확산" : "신규 유입 둔화: 매장 내 앱 안내 점검";
    how = "신규 가입이 많은 매장의 매장 내 앱 안내 방식(포스터·계산대 안내)을 확인해 하위 매장에 동일 적용 (매장별 신규 가입은 다음 단계 데이터)";
    kpi = `다음 달 일평균 신규 가입회원 증감률 (이번 달 ${pctStr(e.cur)})`;
  } else {
    facts.push(`앱 비중 ${e.cur.toFixed(2)}% (전체 매출 대비 그로스잇 앱결제액)`, `최근 ${e.n}개월 평균 ${e.base.toFixed(2)}% 대비 ${ppStr(e.cur - e.base, 2)}`);
    title = up ? "앱 비중 상승 유지: 앱 주문 비중이 높은 매장 사례 확산" : "앱 비중 하락 대응: 매장 내 앱 주문 유도 점검";
    how = "앱 비중이 낮은 매장의 앱 안내·쿠폰 운영 현황을 점검 (매장별 앱 비중은 다음 단계 데이터)";
    kpi = `다음 달 앱 비중 (이번 달 ${e.cur.toFixed(2)}%)`;
  }
  return { key: m.key, name: m.name, domain: m.domain, cur, base, delta, down: !up, z: e.z, n: e.n, facts, title, how, kpi, rawCur: e.cur };
}

// 점수 = |z| (나빠진 방향은 ×1.3). 같은 영역은 1개만, 최대 3개.
function pickInsights(snaps: MonthSnapshot[], idx: number): Insight[] {
  const cands = METRICS.map((m) => {
    const e = evalMetric(m, snaps, idx);
    return e ? { m, e, score: Math.abs(e.z) * (e.z < 0 ? 1.3 : 1) } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  cands.sort((a, b) => b.score - a.score);
  const used = new Set<string>();
  const out: Insight[] = [];
  for (const c of cands) {
    if (used.has(c.m.domain)) continue;
    used.add(c.m.domain);
    out.push(buildInsight(c.m, c.e, snaps, idx));
    if (out.length >= 3) break;
  }
  return out;
}

function weekendRatio(list: { date: string; orders: number }[]): { ratio: number; we: number; wd: number } | null {
  const we = list.filter((d) => [0, 6].includes(new Date(`${d.date}T00:00:00`).getDay()));
  const wd = list.filter((d) => ![0, 6].includes(new Date(`${d.date}T00:00:00`).getDay()));
  if (we.length === 0 || wd.length === 0) return null;
  const a = mean(we.map((d) => d.orders));
  const b = mean(wd.map((d) => d.orders));
  return b > 0 ? { ratio: a / b, we: a, wd: b } : null;
}

const CSS = `
:root{--bg:#F4F6FA;--paper:#fff;--ink:#14213D;--muted:#5C6678;--line:#DDE3EE;--accent:#2EC4B6;--accent-ink:#0B7F74;--accent-soft:#E3F6F4;--navy:#14213D;--up:#0B7F74;--down:#C2410C;--chip:#EDF1F7;--f:'IBM Plex Sans KR',-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;--fn:'IBM Plex Mono',ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0F1626;--paper:#17213A;--ink:#EAF0FA;--muted:#9FAAC0;--line:#2A3552;--accent:#2EC4B6;--accent-ink:#5FE0D3;--accent-soft:#16363A;--navy:#EAF0FA;--up:#5FE0D3;--down:#F29A72;--chip:#212C47}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--f);font-size:15px;line-height:1.6;padding:24px 16px 64px}
.wrap{max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:28px}h1,h2,h3{margin:0;line-height:1.3;text-wrap:balance}h1{font-size:26px}h2{font-size:18px}h3{font-size:16px}
.num{font-family:var(--fn);font-variant-numeric:tabular-nums}.eyebrow{font-size:12px;letter-spacing:.08em;color:var(--muted);font-weight:600}.muted{color:var(--muted)}.note{font-size:12.5px;color:var(--muted)}
.summary{background:var(--accent-soft);border-radius:12px;padding:18px 20px;font-size:16px;font-weight:500}
section{display:flex;flex-direction:column;gap:14px}.sec-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px}
.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.kpi{background:var(--paper);padding:14px 14px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}.kpi .l{font-size:12.5px;color:var(--muted)}.kpi .v{font-size:19px;font-weight:600}.kpi .s{font-size:12px;color:var(--muted)}
.d{font-size:13px;font-weight:600}.d.up{color:var(--up)}.d.down{color:var(--down)}
.growth{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px}.box{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px 18px;min-width:0}
.chart svg{width:100%;height:auto;display:block}.chart text{fill:var(--muted);font-family:var(--fn);font-size:11px}.chart .lbl{fill:var(--ink);font-weight:600}
.insight{background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden}.insight .top{padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.row1{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}.badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;background:var(--chip);color:var(--muted)}
.metric{display:flex;gap:18px;flex-wrap:wrap;font-size:13.5px;align-items:baseline}.metric b{font-size:20px;font-weight:600;margin-right:4px}.facts{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:14px}
.action{background:var(--accent-soft);padding:14px 18px;display:grid;grid-template-columns:72px minmax(0,1fr);gap:6px 12px;font-size:14px}.action .k{font-size:12px;font-weight:600;color:var(--accent-ink);padding-top:2px}.action .t{font-weight:700;font-size:15px}
.actno{display:inline-flex;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#14213D;font-size:12px;font-weight:700;align-items:center;justify-content:center;margin-right:8px}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600}td.r,th.r{text-align:right;white-space:nowrap}
details{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px 18px}summary{cursor:pointer;font-weight:600}details .in{display:flex;flex-direction:column;gap:12px;margin-top:12px;font-size:13.5px}
.next{border:1px dashed var(--line);border-radius:12px;padding:14px 18px;font-size:13.5px;color:var(--muted)}
@media (max-width:760px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi:first-child{grid-column:1/-1}.growth{grid-template-columns:minmax(0,1fr)}h1{font-size:22px}}
`;

export function buildReportHtml(input: ReportInput, model: ReportModel): string {
  const ym = model.meta.yearMonth;
  const prevYm = model.meta.prevYearMonth;
  const snaps: MonthSnapshot[] = [...input.history.filter((h) => h.yearMonth < ym), currentSnapshot(input, model)].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  const idx = snaps.length - 1;
  const s = snaps[idx];
  const p = idx > 0 && snaps[idx - 1].yearMonth === prevYm ? snaps[idx - 1] : null;
  const days = daysIn(ym);
  const pdays = p ? daysIn(prevYm) : null;

  const perDay = (v: number | null | undefined, d: number | null) => (v != null && d ? v / d : null);
  const chg = (a: number | null, b: number | null) => (a != null && b != null && b !== 0 ? ((a - b) / b) * 100 : null);
  const payDay = perDay(s.appPay, days);
  const payDayP = perDay(p?.appPay, pdays);
  const ordDay = perDay(s.appOrders, days);
  const ordDayP = perDay(p?.appOrders, pdays);
  const ticket = s.appPay != null && s.appOrders ? s.appPay / s.appOrders : null;
  const ticketP = p?.appPay != null && p.appOrders ? p.appPay / p.appOrders : null;
  const newDay = perDay(s.newMembers, days);
  const newDayP = perDay(p?.newMembers, pdays);

  const dEl = (v: number | null, unit: "%" | "원" | "%p") => {
    if (v == null) return `<span class="d muted">전월 비교 없음</span>`;
    const cls = v > 0 ? "up" : v < 0 ? "down" : "";
    const f = unit === "%" ? pctStr(v) : unit === "%p" ? ppStr(v, 2) : `${v > 0 ? "+" : ""}${nf(v)}원`;
    return `<span class="d ${cls} num">${v > 0 ? "▲ " : v < 0 ? "▼ " : ""}${f}</span>`;
  };
  const cardHtml: string[] = [];
  const pushCard = (l: string, v: string, sub: string, d: string) => cardHtml.push(`<div class="kpi"><span class="l">${esc(l)}</span><span class="v num">${esc(v)}</span>${d}<span class="s">${esc(sub)}</span></div>`);
  if (payDay != null) pushCard("일평균 앱 결제금액", won(payDay), `월 합계 ${won(s.appPay!)}`, dEl(chg(payDay, payDayP), "%"));
  if (ordDay != null) pushCard("일평균 앱 주문수", `${nf(ordDay)}건`, `월 합계 ${nf(s.appOrders!)}건`, dEl(chg(ordDay, ordDayP), "%"));
  if (ticket != null) pushCard("객단가", `${nf(ticket)}원`, ticketP != null ? `전월 ${nf(ticketP)}원` : "", dEl(ticketP != null ? ticket - ticketP : null, "원"));
  if (newDay != null) pushCard("일평균 신규 가입회원", `${nf(newDay)}명`, `월 합계 ${nf(s.newMembers!)}명`, dEl(chg(newDay, newDayP), "%"));
  if (s.appShare != null) pushCard("앱 비중", `${s.appShare.toFixed(2)}%`, "전체 매출 대비 그로스잇 앱", dEl(p?.appShare != null ? s.appShare - p.appShare : null, "%p"));

  // 요약 문장
  const summary =
    payDay != null && payDayP != null
      ? `일평균 앱 결제금액은 ${won(payDay)}으로 ${monthLabel(prevYm).replace(/^\d+년 /, "")}보다 ${Math.abs(chg(payDay, payDayP)!).toFixed(1)}% ${payDay >= payDayP ? "늘었습니다" : "줄었습니다"}. 일평균 증감 ${won(Math.abs(payDay - payDayP))}${ordDay != null && ordDayP != null ? `, 일평균 주문수는 ${Math.abs(chg(ordDay, ordDayP)!).toFixed(1)}% ${ordDay >= ordDayP ? "증가" : "감소"}했습니다` : ""}.`
      : payDay != null
        ? `일평균 앱 결제금액은 ${won(payDay)}입니다. 전월 데이터가 없어 비교는 생략합니다.`
        : "수집된 데이터가 부족해 요약 문장을 만들지 못했습니다.";

  // 일평균 추이 막대(최근 6개월)
  const series = snaps
    .map((x) => ({ m: x.yearMonth, v: perDay(x.appPay, daysIn(x.yearMonth)) }))
    .filter((x): x is { m: string; v: number } => x.v != null)
    .slice(-6);
  let chart = "";
  if (series.length > 0) {
    const W = 420, H = 190, pad = { l: 8, r: 8, t: 26, b: 34 };
    const mx = Math.max(...series.map((x) => x.v)) * 1.08;
    const bw = (W - pad.l - pad.r) / series.length;
    const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / mx);
    const bars = series
      .map((h, k) => {
        const x = pad.l + k * bw + bw * 0.18, w = bw * 0.64, last = k === series.length - 1;
        return `<rect x="${x.toFixed(1)}" y="${y(h.v).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - pad.b - y(h.v)).toFixed(1)}" rx="3" fill="var(--accent)" opacity="${last ? 1 : 0.4}"/><text x="${(x + w / 2).toFixed(1)}" y="${(y(h.v) - 7).toFixed(1)}" text-anchor="middle" class="${last ? "lbl" : ""}">${(h.v / 1e6).toFixed(0)}</text><text x="${(x + w / 2).toFixed(1)}" y="${H - pad.b + 16}" text-anchor="middle">${Number(h.m.slice(5))}월</text>`;
      })
      .join("");
    chart = `<h3>일평균 결제금액 추이 <span class="note" style="font-weight:400">(백만원)</span></h3><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 일평균 앱 결제금액"><line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="var(--line)"/>${bars}</svg>`;
  }

  // 증가분 / 주문 유형 / 주말·평일
  const wk = weekendRatio(model.sales.daily.map((d) => ({ date: d.date, orders: d.orders })));
  const wkP = weekendRatio(model.sales.prevDaily.map((d) => ({ date: d.date, orders: d.orders })));
  const typeTotal = model.sales.byOrderType.reduce((a, b) => a + b.pay, 0);
  const g = model.growth;
  const manS = (n: number) => `${n >= 0 ? "+" : "-"}${nf(Math.abs(n) / 1e4)}만원`;
  let growthBox: string;
  if (g) {
    const posSame = Math.max(g.sameDelta, 0);
    const posOther = Math.max(g.otherDelta, 0);
    const sp = posSame + posOther > 0 ? (posSame / (posSame + posOther)) * 100 : 50;
    growthBox = `<h3>매출 증가는 어디서 왔나</h3>
    <div class="split" aria-hidden="true"><span style="width:${sp.toFixed(1)}%"></span><span style="width:${(100 - sp).toFixed(1)}%"></span></div>
    <div class="legend">
      <div><i style="background:var(--accent)"></i>기존 매장 ${nf(g.sameStores)}곳 <b class="num">${manS(g.sameDelta)}</b> <span class="muted">${g.sameChgPct != null ? `(매장 매출 ${pctStr(g.sameChgPct)})` : ""}</span></div>
      <div><i style="background:var(--muted);opacity:.45"></i>신규 오픈 ${nf(g.newStores)}곳 포함 기타 매장 <b class="num">${manS(g.otherDelta)}</b></div>
      ${wk ? `<div class="muted">주말/평일 일평균 주문 비율 <b class="num">${wk.ratio.toFixed(2)}배</b>${wkP ? ` (전월 ${wkP.ratio.toFixed(2)}배)` : ""}</div>` : ""}
    </div>
    <p class="note" style="margin:10px 0 0">일평균 앱 결제금액 증감 ${manS(g.totalDelta)} 기준. 기존 매장 = ${g.basis === "2개월 연속" ? "직전 2개월 연속 앱 결제가 있던 매장" : "직전 1개월 앱 결제가 있던 매장(전전월 데이터 없음)"}. 기존 매장 중 일평균 20% 이상 줄어든 매장 ${nf(g.decliners.count)}곳${g.decliners.ratePct != null ? ` (${g.decliners.ratePct.toFixed(1)}%)` : ""}.${g.topGainers.length > 0 ? ` 증가액 상위: ${g.topGainers.map((t) => `${esc(t.name)} ${manS(t.delta)}`).join(", ")}.` : ""}</p>`;
  } else {
    growthBox = `<h3>일평균 증감 요약</h3>
    <div class="legend" style="display:flex;flex-direction:column;gap:6px;margin-top:10px;font-size:13.5px">
      ${payDay != null && payDayP != null ? `<div>일평균 결제금액 <b class="num">${payDay - payDayP >= 0 ? "+" : "-"}${won(Math.abs(payDay - payDayP))}</b> <span class="muted">(${pctStr(chg(payDay, payDayP)!)})</span></div>` : ""}
      ${wk ? `<div>주말/평일 일평균 주문 비율 <b class="num">${wk.ratio.toFixed(2)}배</b> <span class="muted">${wkP ? `(전월 ${wkP.ratio.toFixed(2)}배)` : ""}</span></div>` : ""}
      ${model.sales.byOrderType.length > 0 && typeTotal > 0 ? `<div>앱 결제 구성 ${model.sales.byOrderType.map((t) => `${esc(t.label)} ${((t.pay / typeTotal) * 100).toFixed(0)}%`).join(" · ")}</div>` : ""}
    </div>
    <p class="note" style="margin:10px 0 0">기존 매장/신규 매장별 기여도는 전월 매장별 데이터가 있어야 계산됩니다(전월 데이터를 다시 수집하면 표시됩니다).</p>`;
  }

  // 주목할 변화
  const insights = pickInsights(snaps, idx);
  const insightsHtml =
    insights.length === 0
      ? `<div class="next">최근 몇 개월의 비교 데이터가 부족해 이번 달은 "주목할 변화"를 고르지 않았습니다. 월별 데이터가 3개월 이상 쌓이면 자동으로 표시됩니다.</div>`
      : insights
          .map(
            (x, k) => `<article class="insight"><div class="top"><div class="row1"><h3><span class="actno">${k + 1}</span>${esc(x.name)}</h3><span class="badge">평소 변동폭의 ${Math.abs(x.z).toFixed(1)}배 · 근거 ${x.n}개월</span></div>
        <div class="metric"><span><b class="num">${esc(x.cur)}</b>이번 달</span><span><b class="num" style="font-size:16px">${esc(x.base)}</b>최근 평균</span><span class="d ${x.down ? "down" : "up"} num">${esc(x.delta)}</span></div>
        <ul class="facts">${x.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
        <div class="action"><span class="k">액션</span><span class="t">${esc(x.title)}</span><span class="k">실행 방법</span><span>${esc(x.how)}</span><span class="k">측정 지표</span><span>${esc(x.kpi)}</span></div></article>`
          )
          .join("");

  // 메뉴 변화 — 일평균 판매수량(수량 필드가 없으면 앱결제액) 기준, 표기만 다른 같은 메뉴는 합산
  const mc = model.menuChange;
  const menuUnit = mc?.basis === "수량" ? "개/일" : "원/일";
  const menuList = (rows: { name: string; txt: string }[], cls: string, empty: string) =>
    rows.length === 0 ? `<li class="muted">${empty}</li>` : rows.map((r) => `<li style="display:flex;justify-content:space-between;gap:8px"><span>${esc(r.name)}</span><span class="d ${cls} num">${esc(r.txt)}</span></li>`).join("");
  const menuHtml = mc
    ? `<section><div class="sec-head"><h2>메뉴 변화</h2><span class="note">일평균 ${mc.basis === "수량" ? "판매수량" : "앱결제액"} 기준 · 월 ${mc.basis === "수량" ? `${nf(mc.threshold)}개` : `${nf(mc.threshold / 1e4)}만원`} 이상 판매 메뉴</span></div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px">
      <div class="box"><h3 style="font-size:14px;margin-bottom:8px">많이 늘어난 메뉴</h3><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:13.5px">${menuList(mc.up.map((r) => ({ name: r.name, txt: pctStr(r.chg, 0) })), "up", "해당 없음")}</ul></div>
      <div class="box"><h3 style="font-size:14px;margin-bottom:8px">많이 줄어든 메뉴</h3><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:13.5px">${menuList(mc.down.map((r) => ({ name: r.name, txt: pctStr(r.chg, 0) })), "down", "해당 없음")}</ul></div>
      <div class="box"><h3 style="font-size:14px;margin-bottom:8px">이번 달 새로 판매된 메뉴</h3><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:13.5px">${menuList(mc.added.map((r) => ({ name: r.name, txt: `${nf(r.cur)}${mc.basis === "수량" ? "개" : "원"}` })), "up", "해당 없음")}</ul></div>
    </div><p class="note" style="margin:0">단위: ${menuUnit}. 같은 메뉴가 표기만 달라 따로 등록된 경우(띄어쓰기·괄호)는 합산했습니다. 이름 철자가 다르게 새로 등록된 메뉴는 별개 메뉴로 보일 수 있습니다.</p></section>`
    : "";

  // 지난 제안 추적 — 전월 시점에 같은 방식으로 뽑았을 제안을 다시 계산해, 그 지표가 이번 달 어떻게 움직였는지 봅니다.
  let trackingHtml = "";
  if (idx >= 1) {
    const prevInsights = pickInsights(snaps, idx - 1);
    const rows = prevInsights
      .map((pi) => {
        const m = METRICS.find((x) => x.key === pi.key)!;
        const e = evalMetric(m, snaps, idx);
        if (!e) return "";
        const fmt = (v: number) => (m.mode === "growth" ? pctStr(v) : m.key === "ticket" ? `${nf(v)}원` : `${v.toFixed(2)}%`);
        const diff = e.cur - pi.rawCur;
        const dTxt = m.mode === "growth" ? ppStr(diff) : m.key === "ticket" ? `${diff > 0 ? "+" : ""}${nf(diff)}원` : ppStr(diff, 2);
        return `<tr><td>${esc(pi.title)}</td><td>${esc(pi.name)}</td><td class="r num">${esc(fmt(pi.rawCur))}</td><td class="r num">${esc(fmt(e.cur))}</td><td class="r num">${esc(dTxt)}</td></tr>`;
      })
      .filter(Boolean);
    if (rows.length > 0) {
      trackingHtml = `<section><div class="sec-head"><h2>지난 리포트 제안 지표 추적</h2></div><div class="box tbl"><table><thead><tr><th>${Number(prevYm.slice(5))}월 리포트 제안</th><th>측정 지표</th><th class="r">제안 시점</th><th class="r">이번 달</th><th class="r">변화</th></tr></thead><tbody>${rows.join("")}</tbody></table>
      <p class="note" style="margin:10px 0 0">전월 제안은 이 리포트와 같은 방식으로 전월 시점에 다시 계산한 값입니다(발행 이력이 쌓이면 실제 발행한 제안으로 대체). 실행 여부와 관계없는 지표 변화입니다. 액션의 순수 효과를 보려면 발송 시 대상의 일부(예: 10%)를 미발송 대조군으로 남겨 비교해야 합니다.</p></div></section>`;
    }
  }

  // 담당자 입력(목표·액션)
  const pl = model.plan;
  const planHtml =
    pl.goals.length + pl.actions.length === 0
      ? ""
      : `<section><div class="sec-head"><h2>담당자 입력: 익월 목표 · 액션</h2></div><div class="box tbl"><table><thead><tr><th>구분</th><th>내용</th><th>담당·기한/목표</th></tr></thead><tbody>
      ${pl.goals.map((g) => `<tr><td>목표</td><td>${esc(g.metric)}</td><td>${esc(g.target)}</td></tr>`).join("")}
      ${pl.actions.map((a) => `<tr><td>액션</td><td>${esc(a.title)}</td><td>${esc([a.owner, a.due].filter(Boolean).join(" · "))}</td></tr>`).join("")}
      </tbody></table>${pl.note ? `<p class="note" style="margin:10px 0 0">${esc(pl.note)}</p>` : ""}</div></section>`;

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.meta.brandName)} 그로스잇 월간 리포트 ${esc(ym)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap">
<style>${CSS}</style></head><body><div class="wrap">
<header><div class="eyebrow">GROWTHIT MONTHLY · ${esc(model.meta.brandName)}</div><h1>${esc(model.meta.brandName)} 그로스잇 월간 리포트</h1>
<div class="note">${esc(monthLabel(ym))} · 그로스잇 앱 결제 기준 · 월 1회 · 담당자 요청 시 발행 · growthit, Powered by Wylie</div></header>
<div class="summary">${esc(summary)}</div>
<section><div class="sec-head"><h2>이번 달 핵심 지표</h2><span class="note">${days}일${pdays ? ` / 전월 ${pdays}일` : ""} → 금액·주문수는 일평균으로 비교</span></div>
<div class="kpis">${cardHtml.join("")}</div>
<div class="growth"><div class="box">${growthBox}</div><div class="box chart">${chart || '<p class="note">추이 데이터가 없습니다.</p>'}</div></div></section>
<section><div class="sec-head"><h2>이번 달 주목할 변화와 액션 플랜</h2><span class="note">평소 변동폭 대비 가장 크게 움직인 지표 (최대 3개)</span></div><div style="display:flex;flex-direction:column;gap:14px">${insightsHtml}</div></section>
${menuHtml}${trackingHtml}${planHtml}
<div class="next"><b>다음 단계 예정 항목</b> — 구매회원·재구매율·푸드 동반구매율 등 주문 원본 기반 지표는 주문 단위 데이터가 확보되면 이 리포트에 추가됩니다.</div>
<details><summary>지표 선정 방식 · 데이터 기준</summary><div class="in">
<p style="margin:0">지표마다 최근 개월(최대 3개월)의 평소 값과 평소 변동폭을 구하고, 이번 달 값이 평소에서 변동폭의 몇 배 벗어났는지로 순위를 매깁니다(성장률 지표는 전월 대비 증감률을 비교). 나빠진 방향의 변화에는 가중치 1.3을 주고, 같은 영역(예: 일평균 매출·주문)에서는 1개만 고릅니다. 근거 개월 수가 2개월 미만인 지표는 제외합니다.</p>
<p class="note" style="margin:0">데이터 기준: 그로스잇 CMS 월 집계(앱 결제금액 = "우리가잇다" 채널 실결제액, 전체 매출 = 온라인+오프라인). 일평균 = 월 합계 ÷ 해당 월 일수. 객단가 = 앱 결제금액 ÷ 앱 주문수. 신규 가입회원 = CMS 신규 회원 수(가입 기준이며, 첫 주문 기준 '신규 구매회원'과 다릅니다). 숫자는 CMS 집계 반올림 등으로 팀 내부 원본 계산과 2% 미만 오차가 있을 수 있습니다. 표의 수치는 집계값에서 계산한 값이며 원인에 대한 추정은 포함하지 않습니다.</p></div></details>
</div></body></html>`;
  return html;
}

// 당월 스냅샷 — buildReportModel이 쓰는 것과 같은 방식(저장 데이터 → 스냅샷)으로 만듭니다.
function currentSnapshot(input: ReportInput, model: ReportModel): MonthSnapshot {
  return snapshotFromData(model.meta.yearMonth, input.current);
}
