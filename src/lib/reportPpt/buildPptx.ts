// 리포트 모델(ReportModel) → PPT(.pptx). 2026-10-05 결정: QR오더 PPT 자산 대신 와일리/그로스잇 기본 스타일
// (Navy #14213D + Mint #2EC4B6)로 먼저 만들고, 담당자가 새 템플릿을 올리면 교체합니다.
// 서버(Node)에서 pptxgenjs로 생성해 바이너리로 내려줍니다 — 차트는 PowerPoint 네이티브 차트라 열어서 수정할 수 있습니다.

import PptxGenJS from "pptxgenjs";
import { fmtNum, fmtPct, fmtSigned, fmtWon, fmtWonShort, monthLabel, monthShort } from "@/lib/reportMetrics/format";
import type { Kpi, ReportModel } from "@/lib/reportMetrics/types";

const C = {
  navy: "14213D",
  mint: "2EC4B6",
  mintDark: "1A9E92",
  ink: "1B2340",
  gray: "6B7280",
  line: "E5E7EB",
  card: "F3F6FA",
  white: "FFFFFF",
  warn: "D97706",
  bad: "DC2626",
  good: "059669",
  mintSoft: "DDF5F2",
  navySoft: "DCE3F0",
};
const FONT = "Malgun Gothic";
const W = 10;
const H = 5.625;
const PALETTE = [C.mint, C.navy, "5B7DB1", "A5B4CC", "F5B94B", "9AD9D2"];

type Slide = PptxGenJS.Slide;

function deltaText(k: Kpi): { text: string; color: string } {
  if (k.pct == null) return { text: "전월 비교 없음", color: C.gray };
  const unit = k.unit === "%" ? "%p" : "%";
  const up = k.pct > 0;
  const flat = k.pct === 0;
  return { text: `전월 대비 ${fmtSigned(k.pct, unit)}`, color: flat ? C.gray : up ? C.good : C.bad };
}
function kpiValue(k: Kpi): string {
  if (k.value == null) return "-";
  if (k.unit === "원") return fmtWonShort(k.value) === fmtNum(k.value) ? fmtWon(k.value) : `${fmtWonShort(k.value)}원`;
  if (k.unit === "%") return fmtPct(k.value, 2);
  return `${fmtNum(k.value)}${k.unit}`;
}

function frame(pres: PptxGenJS, model: ReportModel, no: string, title: string, subtitle?: string): Slide {
  const s = pres.addSlide();
  s.background = { color: C.white };
  s.addShape(pres.ShapeType.ellipse, { x: 0.5, y: 0.34, w: 0.42, h: 0.42, fill: { color: C.mint }, line: { color: C.mint } });
  s.addText(no, { x: 0.5, y: 0.34, w: 0.42, h: 0.42, align: "center", valign: "middle", fontFace: FONT, fontSize: 11, bold: true, color: C.navy, margin: 0, isTextBox: true });
  s.addText(title, { x: 1.05, y: 0.3, w: 8.4, h: 0.5, fontFace: FONT, fontSize: 22, bold: true, color: C.navy, margin: 0, valign: "middle", isTextBox: true });
  if (subtitle) s.addText(subtitle, { x: 1.05, y: 0.8, w: 8.4, h: 0.3, fontFace: FONT, fontSize: 11, color: C.gray, margin: 0, isTextBox: true });
  s.addText(`growthit, Powered by Wylie  ·  ${model.meta.brandName} ${monthLabel(model.meta.yearMonth)} 성과 리포트`, {
    x: 0.5, y: 5.25, w: 7, h: 0.25, fontFace: FONT, fontSize: 8, color: C.gray, margin: 0, isTextBox: true,
  });
  return s;
}

function card(pres: PptxGenJS, s: Slide, x: number, y: number, w: number, h: number, fill: string = C.card) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: fill }, rectRadius: 0.08 });
}

function kpiCard(pres: PptxGenJS, s: Slide, x: number, y: number, w: number, h: number, k: Kpi, dark = false) {
  card(pres, s, x, y, w, h, dark ? C.navy : C.card);
  const d = deltaText(k);
  s.addText(k.label, { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: 0.28, fontFace: FONT, fontSize: 10, color: dark ? "B8C4DA" : C.gray, margin: 0, isTextBox: true });
  s.addText(kpiValue(k), { x: x + 0.15, y: y + 0.38, w: w - 0.3, h: h - 0.85, fontFace: FONT, fontSize: 20, bold: true, color: dark ? C.white : C.navy, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
  s.addText(d.text, { x: x + 0.15, y: y + h - 0.42, w: w - 0.3, h: 0.28, fontFace: FONT, fontSize: 9, bold: true, color: dark ? (d.color === C.gray ? "B8C4DA" : C.mint) : d.color, margin: 0, isTextBox: true });
}

function stat(pres: PptxGenJS, s: Slide, x: number, y: number, w: number, h: number, label: string, value: string, note?: string) {
  card(pres, s, x, y, w, h);
  s.addText(label, { x: x + 0.12, y: y + 0.08, w: w - 0.24, h: 0.26, fontFace: FONT, fontSize: 9, color: C.gray, margin: 0, isTextBox: true });
  s.addText(value, { x: x + 0.12, y: y + 0.32, w: w - 0.24, h: h - (note ? 0.8 : 0.45), fontFace: FONT, fontSize: 18, bold: true, color: C.navy, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
  if (note) s.addText(note, { x: x + 0.12, y: y + h - 0.45, w: w - 0.24, h: 0.36, fontFace: FONT, fontSize: 8, color: C.gray, margin: 0, valign: "top", isTextBox: true });
}

function empty(s: Slide, x: number, y: number, w: number, h: number, text = "데이터가 없습니다") {
  s.addText(text, { x, y, w, h, align: "center", valign: "middle", fontFace: FONT, fontSize: 11, color: C.gray, isTextBox: true });
}

function sectionLabel(s: Slide, text: string, x: number, y: number, w = 4) {
  s.addText(text, { x, y, w, h: 0.28, fontFace: FONT, fontSize: 11, bold: true, color: C.navy, margin: 0, isTextBox: true });
}

const chartBase = {
  catAxisLabelFontFace: FONT,
  valAxisLabelFontFace: FONT,
  catAxisLabelFontSize: 9,
  valAxisLabelFontSize: 8,
  catAxisLabelColor: C.gray,
  valAxisLabelColor: C.gray,
  valGridLine: { color: C.line, size: 0.5 },
  catGridLine: { style: "none" as const },
  dataLabelFontFace: FONT,
  dataLabelFontSize: 8,
  dataLabelColor: C.ink,
  legendFontFace: FONT,
  legendFontSize: 9,
  legendColor: C.ink,
  titleFontFace: FONT,
  titleFontSize: 11,
  titleColor: C.navy,
};

function addBar(pres: PptxGenJS, s: Slide, x: number, y: number, w: number, h: number, labels: string[], values: number[], opts: { name: string; color?: string; colors?: string[]; horizontal?: boolean; format?: string; title?: string; showValue?: boolean }) {
  s.addChart(pres.ChartType.bar, [{ name: opts.name, labels, values }], {
    x, y, w, h, barDir: opts.horizontal ? "bar" : "col", chartColors: opts.colors ?? [opts.color ?? C.mint],
    showLegend: false, showValue: opts.showValue ?? true, dataLabelPosition: "outEnd", dataLabelFormatCode: opts.format ?? "#,##0", valAxisLabelFormatCode: opts.format ?? "#,##0",
    showTitle: !!opts.title, title: opts.title, barGapWidthPct: 60, ...chartBase,
  } as PptxGenJS.IChartOpts);
}

function addDoughnut(pres: PptxGenJS, s: Slide, x: number, y: number, w: number, h: number, labels: string[], values: number[], title?: string) {
  s.addChart(pres.ChartType.doughnut, [{ name: title ?? "비중", labels, values }], {
    x, y, w, h, holeSize: 58, chartColors: PALETTE.slice(0, labels.length), showLegend: true, legendPos: "r", showPercent: true, showValue: false,
    showTitle: !!title, title, dataLabelColor: C.white, dataLabelFontSize: 8, dataLabelFontFace: FONT, dataBorder: { pt: 1, color: C.white },
    legendFontFace: FONT, legendFontSize: 9, legendColor: C.ink, titleFontFace: FONT, titleFontSize: 11, titleColor: C.navy,
  } as PptxGenJS.IChartOpts);
}

function table(pres: PptxGenJS, s: Slide, x: number, y: number, w: number, colW: number[], head: string[], rows: string[][], opts: { fontSize?: number; rowH?: number; align?: ("left" | "center" | "right")[]; cellColor?: (text: string, col: number) => string | undefined } = {}) {
  const fs = opts.fontSize ?? 9;
  const al = opts.align ?? head.map((_, i) => (i === 0 ? "left" : "right"));
  const cell = (text: string, i: number, header: boolean): PptxGenJS.TableCell => ({
    text,
    options: {
      fontFace: FONT, fontSize: fs, bold: header || (!!opts.cellColor && !!opts.cellColor(text, i)), color: header ? C.white : (opts.cellColor?.(text, i) ?? C.ink), fill: { color: header ? C.navy : C.white },
      align: al[i], valign: "middle", border: [{ type: "none" }, { type: "none" }, { type: "solid", pt: 0.5, color: C.line }, { type: "none" }], margin: [0.03, 0.08, 0.03, 0.08],
    },
  });
  s.addTable([head.map((t, i) => cell(t, i, true)), ...rows.map((r) => r.map((t, i) => cell(t, i, false)))], { x, y, w, colW, rowH: opts.rowH ?? 0.28 });
}

export async function buildReportPptx(model: ReportModel): Promise<Buffer> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
  pres.author = "Wylie · growthit";
  pres.company = "㈜와일리";
  pres.title = `${model.meta.brandName} ${monthLabel(model.meta.yearMonth)} 성과 리포트`;

  const k = (key: string) => model.summary.kpis.find((x) => x.key === key)!;

  // 1. 표지 ──────────────────────────────────────────────────────────────
  {
    const s = pres.addSlide();
    s.background = { color: C.navy };
    s.addShape(pres.ShapeType.ellipse, { x: 7.2, y: 0.9, w: 3.6, h: 3.6, fill: { color: C.mint, transparency: 78 }, line: { color: C.mint, transparency: 78 } });
    s.addShape(pres.ShapeType.ellipse, { x: 8.2, y: 2.9, w: 2.4, h: 2.4, fill: { color: C.mint, transparency: 60 }, line: { color: C.mint, transparency: 60 } });
    s.addText("MONTHLY PERFORMANCE REPORT", { x: 0.7, y: 1.2, w: 7, h: 0.35, fontFace: FONT, fontSize: 12, bold: true, color: C.mint, charSpacing: 3, margin: 0, isTextBox: true });
    s.addText(`${model.meta.brandName}\n${monthLabel(model.meta.yearMonth)} 성과 리포트`, { x: 0.7, y: 1.7, w: 7.5, h: 1.6, fontFace: FONT, fontSize: 36, bold: true, color: C.white, margin: 0, valign: "top", fit: "shrink", isTextBox: true });
    s.addText("성장을 잇다, 그로스잇", { x: 0.7, y: 3.5, w: 6, h: 0.4, fontFace: FONT, fontSize: 14, italic: true, color: "B8C4DA", margin: 0, isTextBox: true });
    const d = new Date(model.meta.generatedAt);
    s.addText(`${model.meta.companyName}  ·  월 1회 · 담당자 요청 시 발행  ·  발행일 ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`, { x: 0.7, y: 4.75, w: 7, h: 0.3, fontFace: FONT, fontSize: 10, color: "B8C4DA", margin: 0, isTextBox: true });
    s.addText("growthit, Powered by Wylie", { x: 0.7, y: 5.05, w: 6, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: C.white, margin: 0, isTextBox: true });
  }

  // 2. 핵심 요약 ─────────────────────────────────────────────────────────
  {
    const s = frame(pres, model, "01", "핵심 요약", `${monthLabel(model.meta.yearMonth)} 그로스잇 성과 한눈에 보기`);
    const top = [k("appPay"), k("appShare"), k("appOrders"), k("saving")];
    top.forEach((kk, i) => kpiCard(pres, s, 0.5 + i * 2.28, 1.25, 2.12, 1.35, kk, i === 0));
    const sub = [k("totalPay"), k("members"), k("newMembers")];
    sub.forEach((kk, i) => kpiCard(pres, s, 0.5 + i * 3.04, 2.78, 2.9, 1.1, kk));
    sectionLabel(s, "이번 달 핵심 메시지", 0.5, 4.02, 4);
    const lines = model.summary.headlines.length > 0 ? model.summary.headlines : ["수집된 데이터가 부족해 요약 문장을 만들지 못했습니다."];
    s.addText(
      lines.slice(0, 4).map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })),
      { x: 0.5, y: 4.3, w: 9, h: 0.92, fontFace: FONT, fontSize: 10, color: C.ink, margin: 0, valign: "top", paraSpaceAfter: 2, fit: "shrink", isTextBox: true }
    );
  }

  // 2-1. 일평균 기준 지표 ────────────────────────────────────────────────
  // 월 일수(28~31일)가 달라 월 합계만 비교하면 착시가 생기므로 일평균으로 다시 봅니다. 전월 일별 데이터가 있으면 같은 일자끼리 겹쳐 그립니다.
  if (model.sales.dailyAvg) {
    const da = model.sales.dailyAvg;
    const s = frame(pres, model, "01+", "일평균 기준 핵심 지표", da.prevDays ? `월 일수 차이 보정 — 당월 ${da.days}일 · 전월 ${da.prevDays}일 기준 하루 평균` : "월 일수 차이를 보정한 하루 평균");
    da.items.forEach((it, i) => {
      const x = 0.5 + i * 2.28;
      card(pres, s, x, 1.25, 2.12, 1.15, i === 0 ? C.navy : C.card);
      const dark = i === 0;
      s.addText(it.label, { x: x + 0.12, y: 1.32, w: 1.88, h: 0.36, fontFace: FONT, fontSize: 9, color: dark ? "B8C4DA" : C.gray, margin: 0, valign: "top", isTextBox: true });
      const val = it.value == null ? "-" : it.unit === "원" ? `${fmtNum(Math.round(it.value / 10000))}만원` : `${fmtNum(it.value)}${it.unit}`;
      s.addText(val, { x: x + 0.12, y: 1.66, w: 1.88, h: 0.42, fontFace: FONT, fontSize: 18, bold: true, color: dark ? C.white : C.navy, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
      const up = (it.pct ?? 0) > 0;
      const dc = it.pct == null ? (dark ? "B8C4DA" : C.gray) : it.pct === 0 ? C.gray : dark ? C.mint : up ? C.good : C.bad;
      s.addText(it.pct == null ? "전월 비교 없음" : `전월 대비 ${fmtSigned(it.pct, "%")}`, { x: x + 0.12, y: 2.08, w: 1.88, h: 0.24, fontFace: FONT, fontSize: 9, bold: true, color: dc, margin: 0, isTextBox: true });
    });
    sectionLabel(s, "일평균 추이 — 일자별 그로스잇 매출 (만원)", 0.5, 2.55, 6);
    const cur = model.sales.daily;
    const prv = model.sales.prevDaily;
    if (cur.length > 0) {
      const n = Math.max(da.days, da.prevDays ?? 0, cur.length);
      const labels = Array.from({ length: n }, (_, i) => String(i + 1));
      const byDay = (list: typeof cur) => {
        const m = new Map(list.map((d) => [Number(d.date.slice(8)), Math.round(d.amount / 10000)]));
        return labels.map((_, i) => m.get(i + 1) ?? null);
      };
      const series = [{ name: `${monthLabel(model.meta.yearMonth)}`, labels, values: byDay(cur) as unknown as number[] }];
      if (prv.length > 0) series.push({ name: `${monthLabel(model.meta.prevYearMonth)}`, labels, values: byDay(prv) as unknown as number[] });
      s.addChart(pres.ChartType.line, series, {
        x: 0.4, y: 2.8, w: 9.2, h: 2.1, chartColors: [C.mint, "A5B4CC"], lineSize: 2, lineDataSymbolSize: 4, showLegend: series.length > 1, legendPos: "b", showValue: false, ...chartBase,
      } as PptxGenJS.IChartOpts);
    } else empty(s, 0.5, 2.9, 9, 1.9);
    s.addText("일평균 = 월 합계 ÷ 해당 월 일수. 월 합계 비교(핵심 요약)와 달리 31일·30일 같은 일수 차이의 영향을 받지 않습니다.", { x: 0.5, y: 4.95, w: 9, h: 0.25, fontFace: FONT, fontSize: 8, color: C.gray, margin: 0, isTextBox: true });
  }

  // 매출 증가는 어디서 왔나(기존/신규 매장 분해) + 메뉴 변화 — 월별 매장·메뉴 전체 목록이 수집된 브랜드만.
  if (model.growth || model.menuChange) {
    const g = model.growth;
    const mc = model.menuChange;
    const s = frame(pres, model, "01+", "매출 증가는 어디서 왔나 · 메뉴 변화", g ? `일평균 앱결제액 기준 — 기존 매장은 ${g.basis} 앱 주문이 있던 매장` : "월별 매장 데이터가 없어 메뉴 변화만 표시합니다");
    const man = (v: number) => `${v >= 0 ? "+" : "-"}${fmtNum(Math.round(Math.abs(v) / 10000))}만원`;
    sectionLabel(s, "기존 매장 vs 신규 오픈 (일평균 증감)", 0.5, 1.2, 4.4);
    if (g) {
      card(pres, s, 0.5, 1.5, 2.1, 1.1, C.navy);
      s.addText("일평균 증감 합계", { x: 0.62, y: 1.56, w: 1.9, h: 0.25, fontFace: FONT, fontSize: 9, color: "B8C4DA", margin: 0, isTextBox: true });
      s.addText(man(g.totalDelta), { x: 0.62, y: 1.84, w: 1.9, h: 0.5, fontFace: FONT, fontSize: 20, bold: true, color: C.white, margin: 0, fit: "shrink", isTextBox: true });
      card(pres, s, 2.75, 1.5, 2.1, 1.1);
      s.addText(`기존 매장 ${fmtNum(g.sameStores)}곳`, { x: 2.87, y: 1.56, w: 1.9, h: 0.25, fontFace: FONT, fontSize: 9, color: C.gray, margin: 0, isTextBox: true });
      s.addText(man(g.sameDelta), { x: 2.87, y: 1.84, w: 1.9, h: 0.4, fontFace: FONT, fontSize: 18, bold: true, color: g.sameDelta >= 0 ? C.good : C.bad, margin: 0, fit: "shrink", isTextBox: true });
      s.addText(g.sameChgPct == null ? "" : `매장 매출 ${fmtSigned(g.sameChgPct, "%")}`, { x: 2.87, y: 2.26, w: 1.9, h: 0.24, fontFace: FONT, fontSize: 9, color: C.gray, margin: 0, isTextBox: true });
      card(pres, s, 0.5, 2.7, 2.1, 1.0);
      s.addText(`신규 오픈 ${fmtNum(g.newStores)}곳 포함 기타`, { x: 0.62, y: 2.76, w: 1.9, h: 0.25, fontFace: FONT, fontSize: 9, color: C.gray, margin: 0, isTextBox: true });
      s.addText(man(g.otherDelta), { x: 0.62, y: 3.05, w: 1.9, h: 0.4, fontFace: FONT, fontSize: 18, bold: true, color: g.otherDelta >= 0 ? C.good : C.bad, margin: 0, fit: "shrink", isTextBox: true });
      card(pres, s, 2.75, 2.7, 2.1, 1.0);
      s.addText("일평균 20%↓ 매장", { x: 2.87, y: 2.76, w: 1.9, h: 0.25, fontFace: FONT, fontSize: 9, color: C.gray, margin: 0, isTextBox: true });
      s.addText(`${fmtNum(g.decliners.count)}곳${g.decliners.ratePct == null ? "" : ` (${g.decliners.ratePct}%)`}`, { x: 2.87, y: 3.05, w: 1.9, h: 0.4, fontFace: FONT, fontSize: 18, bold: true, color: C.navy, margin: 0, fit: "shrink", isTextBox: true });
      if (g.topGainers.length > 0) {
        s.addText(`증가액 상위: ${g.topGainers.map((t) => `${t.name} ${man(t.delta)}`).join(" · ")}`, { x: 0.5, y: 3.85, w: 4.4, h: 0.8, fontFace: FONT, fontSize: 9, color: C.gray, margin: 0, valign: "top", isTextBox: true });
      }
    } else empty(s, 0.5, 1.5, 4.4, 2.5, "월별 매장 데이터가 부족합니다");
    sectionLabel(s, `메뉴 변화 (일평균 ${mc ? mc.basis : ""} 기준 · 월 ${mc ? (mc.basis === "수량" ? `${fmtNum(mc.threshold)}개` : "500만원") : ""} 이상)`, 5.2, 1.2, 4.4);
    if (mc) {
      const rows: string[][] = [];
      mc.up.forEach((m) => rows.push(["늘어남", m.name, `${fmtNum(m.prev)}→${fmtNum(m.cur)}`, fmtSigned(Math.round(m.chg * 10) / 10, "%")]));
      mc.down.forEach((m) => rows.push(["줄어듦", m.name, `${fmtNum(m.prev)}→${fmtNum(m.cur)}`, fmtSigned(Math.round(m.chg * 10) / 10, "%")]));
      mc.added.forEach((m) => rows.push(["신규", m.name, "-", fmtNum(m.cur)]));
      if (rows.length > 0) table(pres, s, 5.2, 1.5, 4.4, [0.7, 2.0, 1.0, 0.7], ["구분", "메뉴", "일평균", "증감"], rows, { fontSize: 8, rowH: 0.3, align: ["left", "left", "right", "right"], cellColor: (t, c) => (c === 0 ? (t === "줄어듦" ? C.bad : t === "늘어남" ? C.good : C.navy) : undefined) });
      else empty(s, 5.2, 1.5, 4.4, 2.5, "기준을 넘는 메뉴 변화가 없습니다");
    } else empty(s, 5.2, 1.5, 4.4, 2.5, "월별 메뉴 데이터가 없습니다");
  }

  // 3. 매출·GMV (구성·추이) ────────────────────────────────────────────────
  {
    const sl = model.sales;
    const s = frame(pres, model, "02", "매출 · GMV 성과", "전체 매출 중 그로스잇 앱 매출과 6개월 추이");
    sectionLabel(s, "매출 구성 (온라인·오프라인)", 0.5, 1.2, 4.3);
    if (sl.totalPay != null && sl.appPay != null && sl.onlinePay != null && sl.offlinePay != null) {
      const otherOnline = Math.max(0, sl.onlinePay - sl.appPay);
      addDoughnut(pres, s, 0.4, 1.45, 4.6, 2.3, ["그로스잇 앱", "배달앱 등 기타 온라인", "오프라인"], [sl.appPay, otherOnline, sl.offlinePay]);
      stat(pres, s, 0.5, 3.85, 1.45, 1.2, "전체 매출액", `${fmtWonShort(sl.totalPay)}원`, `${fmtWon(sl.totalPay)}`);
      stat(pres, s, 2.03, 3.85, 1.45, 1.2, "그로스잇 매출액", `${fmtWonShort(sl.appPay)}원`, `앱 비중 ${fmtPct(sl.appShare, 2)}`);
      stat(pres, s, 3.56, 3.85, 1.45, 1.2, "앱 주문 수", `${fmtNum(sl.appOrders)}건`, `전체 ${fmtNum(sl.totalOrders)}건`);
    } else empty(s, 0.5, 1.5, 4.5, 3.4, "매장별 매출통계를 수집하지 못했습니다");
    sectionLabel(s, "그로스잇 매출액 6개월 추이 (만원)", 5.3, 1.2, 4.3);
    const t = sl.trend.filter((x) => x.appPay != null);
    if (t.length > 0) {
      addBar(pres, s, 5.2, 1.45, 4.4, 2.5, t.map((x) => monthShort(x.yearMonth)), t.map((x) => Math.round((x.appPay ?? 0) / 10000)), { name: "그로스잇 매출액(만원)" });
      const shares = sl.trend.filter((x) => x.appShare != null);
      s.addText(shares.length > 0 ? `앱 비중: ${shares.map((x) => `${monthShort(x.yearMonth)} ${fmtPct(x.appShare, 2)}`).join("  ·  ")}` : "앱 비중 추이는 앱·전체 구분 수집이 된 달부터 표시됩니다.", {
        x: 5.3, y: 4.05, w: 4.3, h: 0.5, fontFace: FONT, fontSize: 9, color: C.gray, margin: 0, valign: "top", isTextBox: true,
      });
    } else empty(s, 5.3, 1.5, 4.3, 3.4);
  }

  // 4. 매출·GMV (일별·요일·시간대) ──────────────────────────────────────────
  {
    const sl = model.sales;
    const s = frame(pres, model, "02", "매출 · GMV 성과 (일별 · 요일 · 시간대)", sl.ordersSampled ? "주문이 매우 많아 시간대는 일부 주문으로 추정한 참고값입니다(요일은 일별 건수 합계)" : sl.ordersTruncated ? "주문 데이터 일부만 집계되어 요일·시간대는 참고용입니다" : "언제 가장 많이 팔렸는지");
    sectionLabel(s, "일별 그로스잇 매출 (만원)", 0.5, 1.2, 5);
    if (sl.daily.length > 0) {
      s.addChart(pres.ChartType.line, [{ name: "일별 매출(만원)", labels: sl.daily.map((d) => String(Number(d.date.slice(8)))), values: sl.daily.map((d) => Math.round(d.amount / 10000)) }], {
        x: 0.4, y: 1.45, w: 9.2, h: 1.75, chartColors: [C.mint], lineSize: 2, lineDataSymbolSize: 5, showLegend: false, showValue: false, ...chartBase,
      } as PptxGenJS.IChartOpts);
    } else empty(s, 0.5, 1.5, 9, 1.6);
    sectionLabel(s, "요일별 주문 수", 0.5, 3.3, 4.2);
    if (sl.dow.length > 0) addBar(pres, s, 0.4, 3.5, 4.5, 1.7, sl.dow.map((d) => d.label), sl.dow.map((d) => d.orders), { name: "주문 수" });
    else empty(s, 0.5, 3.6, 4.4, 1.5);
    sectionLabel(s, "시간대별 주문 수", 5.2, 3.3, 4.2);
    if (sl.hours.length > 0) addBar(pres, s, 5.1, 3.5, 4.5, 1.7, sl.hours.map((_, h) => String(h)), sl.hours, { name: "주문 수", color: C.navy, showValue: false });
    else empty(s, 5.2, 3.6, 4.4, 1.5);
  }

  // 5. 채널 효율 ─────────────────────────────────────────────────────────
  {
    const ch = model.channel;
    const f = ch.fee;
    const s = frame(pres, model, "03", "채널 효율", `그로스잇 vs 배달앱 — 같은 매출을 배달앱으로 팔았다면 (수수료 ${f.benchmarkRate}% 기준)`);
    sectionLabel(s, "온라인 채널별 매출 (만원)", 0.5, 1.2, 4.3);
    if (ch.channels.length > 0) {
      const rev = [...ch.channels].slice(0, 6).reverse();
      addBar(pres, s, 0.4, 1.45, 4.6, 3.6, rev.map((c) => c.name), rev.map((c) => Math.round(c.pay / 10000)), { name: "매출(만원)", horizontal: true, colors: rev.map((c) => (c.name === "우리가잇다" ? C.mint : "A5B4CC")) });
    } else empty(s, 0.5, 1.5, 4.4, 3.5, "채널별 매출을 수집하지 못했습니다");
    card(pres, s, 5.3, 1.2, 4.2, 3.85);
    sectionLabel(s, "절감액 계산", 5.5, 1.3, 3.8);
    const row = (label: string, value: string, y: number, bold = false, color = C.ink) => {
      s.addText(label, { x: 5.5, y, w: 2.3, h: 0.3, fontFace: FONT, fontSize: 10, color: C.gray, margin: 0, valign: "middle", isTextBox: true });
      s.addText(value, { x: 7.7, y, w: 1.7, h: 0.3, fontFace: FONT, fontSize: 10, bold, color, align: "right", margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
    };
    row("그로스잇 매출액", fmtWon(model.sales.appPay), 1.7);
    row(`배달앱 수수료 환산 (${f.benchmarkRate}%)`, fmtWon(f.benchmarkFee), 2.05);
    row(`그로스잇 수수료`, f.missingFee ? "수수료율 미입력" : fmtWon(f.growthitFee), 2.4);
    s.addText(`배달 ${fmtWonShort(f.deliveryPay)}원×${f.deliveryRate ?? "-"}% + 픽업 ${fmtWonShort(f.pickupPay)}원×${f.pickupRate ?? "-"}%`, { x: 5.5, y: 2.7, w: 3.9, h: 0.26, fontFace: FONT, fontSize: 8, color: C.gray, margin: 0, isTextBox: true });
    card(pres, s, 5.5, 3.05, 3.8, 0.95, C.navy);
    s.addText("이번 달 절감액", { x: 5.65, y: 3.1, w: 3.5, h: 0.28, fontFace: FONT, fontSize: 10, color: "B8C4DA", margin: 0, isTextBox: true });
    s.addText(f.saving == null ? "계산 불가" : fmtWon(f.saving), { x: 5.65, y: 3.38, w: 3.5, h: 0.5, fontFace: FONT, fontSize: 22, bold: true, color: C.mint, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
    row("ROI (절감액 ÷ 수수료)", f.roi == null ? "-" : `${f.roi.toLocaleString("ko-KR")}%`, 4.1, true, C.mintDark);
    row(ch.cumulative ? `누적 절감액 (${ch.cumulative.months}개월)` : "누적 절감액", ch.cumulative ? fmtWon(ch.cumulative.saving) : "-", 4.45, true);
    s.addText("매장·예약 주문은 수수료 계산에서 제외했습니다.", { x: 5.5, y: 4.78, w: 3.9, h: 0.22, fontFace: FONT, fontSize: 7.5, color: C.gray, margin: 0, isTextBox: true });
  }

  // 6. 매장 운영 ─────────────────────────────────────────────────────────
  {
    const st = model.stores;
    const s = frame(pres, model, "04", "매장 운영 지표", "앱 도입 현황과 매장별 그로스잇 매출");
    stat(pres, s, 0.5, 1.2, 2.1, 1.0, "전체 매장", `${fmtNum(st.counts.total)}곳`, `정상 ${fmtNum(st.counts.normal)} · 폐업 ${fmtNum(st.counts.closed)}${st.counts.temporaryClosed ? ` · 휴점 ${fmtNum(st.counts.temporaryClosed)}` : ""}`);
    stat(pres, s, 2.7, 1.2, 2.1, 1.0, "앱 매출 발생 매장", `${fmtNum(st.appStores)}곳`, st.adoptionRate != null ? `정상 매장 대비 ${fmtPct(st.adoptionRate)}` : undefined);
    stat(pres, s, 4.9, 1.2, 2.1, 1.0, "앱 미도입 매장", `${fmtNum(st.notAdopted)}곳`, "미노출 · 개점 전");
    stat(pres, s, 7.1, 1.2, 2.4, 1.0, "신규 오픈 매장", st.newStores ? `${fmtNum(st.newStores.before15 + st.newStores.after15)}곳` : "-", st.newStores ? `15일 이전 ${st.newStores.before15} · 이후 ${st.newStores.after15}` : undefined);
    sectionLabel(s, "그로스잇 매출 TOP 8 매장", 0.5, 2.38, 5);
    if (st.top.length > 0) {
      table(pres, s, 0.5, 2.68, 9, [4.2, 1.9, 1.4, 1.5], ["매장", "그로스잇 매출", "앱 비중", "주문 수"], st.top.slice(0, 8).map((r) => [r.name, fmtWon(r.appPay), fmtPct(r.appShare), `${fmtNum(r.orders)}건`]), { fontSize: 9, rowH: 0.27 });
    } else empty(s, 0.5, 2.8, 9, 2.2, "매장별 매출통계를 수집하지 못했습니다");
  }

  // 7. 멤버십·고객 (회원·등급) ─────────────────────────────────────────────
  {
    const mb = model.members;
    const s = frame(pres, model, "05", "멤버십 · 고객 지표 (회원)", mb.levels.length > 0 ? "회원 규모와 세그먼트·등급 분포" : "회원 규모와 세그먼트 분포");
    const totalDelta = mb.total != null && mb.totalPrev != null ? ((mb.total - mb.totalPrev) / mb.totalPrev) * 100 : null;
    stat(pres, s, 0.5, 1.2, 2.2, 1.05, "전체 회원", `${fmtNum(mb.total)}명`, totalDelta != null ? `전월 대비 ${fmtSigned(totalDelta)}` : undefined);
    stat(pres, s, 2.8, 1.2, 2.2, 1.05, "신규 회원", `${fmtNum(mb.newMembers)}명`);
    stat(pres, s, 5.1, 1.2, 2.2, 1.05, "일 평균 방문", mb.visitors ? `${fmtNum(mb.visitors.avgDaily)}명` : "-", mb.visitors ? `Android ${fmtPct((mb.visitors.aos / Math.max(1, mb.visitors.total)) * 100, 0)} · iOS ${fmtPct((mb.visitors.ios / Math.max(1, mb.visitors.total)) * 100, 0)}` : undefined);
    stat(pres, s, 7.4, 1.2, 2.1, 1.05, "구매 회원(당월)", mb.buyers?.buyers != null ? `${fmtNum(mb.buyers.buyers)}명` : "-");
    sectionLabel(s, "회원 세그먼트", 0.5, 2.45, 4.3);
    if (mb.segments.length > 0) addDoughnut(pres, s, 0.4, 2.7, 4.6, 2.45, mb.segments.map((x) => x.label), mb.segments.map((x) => x.count));
    else empty(s, 0.5, 2.8, 4.4, 2.2);
    if (mb.levels.length > 0) {
      sectionLabel(s, "회원 등급 분포 (명)", 5.3, 2.45, 4.3);
      addBar(pres, s, 5.2, 2.7, 4.4, 2.45, mb.levels.map((x) => x.label), mb.levels.map((x) => x.count), { name: "회원 수", color: C.navy });
    } else {
      // 등급제가 없는 브랜드: 빈 등급 차트 대신 세그먼트 상세표를 보여줍니다.
      sectionLabel(s, "세그먼트별 회원 수", 5.3, 2.45, 4.3);
      if (mb.segments.length > 0) {
        table(pres, s, 5.3, 2.8, 4.2, [1.9, 1.3, 1.0], ["세그먼트", "회원 수", "비중"], mb.segments.map((x) => [x.label, `${fmtNum(x.count)}명`, fmtPct(x.rate)]), { fontSize: 9.5, rowH: 0.36 });
      } else empty(s, 5.3, 2.8, 4.3, 2.2);
    }
  }

  // 8. 멤버십·고객 (메뉴·성별·연령) ─────────────────────────────────────────
  {
    const mb = model.members;
    const s = frame(pres, model, "05", "멤버십 · 고객 지표 (메뉴 · 성별 · 연령)", "무엇을, 누가 사는지");
    sectionLabel(s, "인기 메뉴 TOP 5 (그로스잇 매출, 만원)", 0.5, 1.2, 5);
    if (mb.topItems.length > 0) {
      const t = mb.topItems.slice(0, 5).reverse();
      addBar(pres, s, 0.4, 1.45, 5.2, 3.65, t.map((x) => x.name), t.map((x) => Math.round(x.appPay / 10000)), { name: "매출(만원)", horizontal: true });
    } else empty(s, 0.5, 1.5, 5, 3.5, "메뉴별 매출을 수집하지 못했습니다");
    sectionLabel(s, "성별 매출 비중", 5.9, 1.2, 3.6);
    if (mb.gender.length > 0) addDoughnut(pres, s, 5.8, 1.45, 3.8, 1.75, mb.gender.map((x) => x.label), mb.gender.map((x) => x.pay));
    else empty(s, 5.9, 1.5, 3.6, 1.6);
    sectionLabel(s, "연령대 매출 비중 (%)", 5.9, 3.3, 3.6);
    if (mb.ages.length > 0) addBar(pres, s, 5.8, 3.5, 3.8, 1.65, mb.ages.map((x) => x.label), mb.ages.map((x) => x.share), { name: "비중(%)", color: C.navy, format: "0.0" });
    else empty(s, 5.9, 3.6, 3.6, 1.5);
  }

  // 9. 멤버십·고객 (구매 행동) ─────────────────────────────────────────────
  // 회원별 구매 집계가 없으면(월 주문이 매우 많은 대형 브랜드·수집 전) 빈 안내 슬라이드를 만들지 않고 건너뜁니다
  // (2026-10-07). 제외 사실은 마지막 "데이터 체크리스트"에 '제외'로 남습니다.
  {
    const b = model.members.buyers;
    if (b) {
      const s = frame(pres, model, "05", "멤버십 · 고객 지표 (구매 행동)", `${b.months.map(monthShort).join("·")} 구매 집계 기준${b.truncated ? " (일부만 집계)" : ""}`);
      sectionLabel(s, "구매 빈도 (기간 합산 주문 횟수 기준)", 0.5, 1.2, 5);
      (b.frequency ?? []).forEach((f, i) => {
        const x = 0.5 + i * 1.9;
        card(pres, s, x, 1.5, 1.8, 1.55, i === 2 ? C.navy : C.card);
        s.addText(`${f.threshold}회 이상`, { x: x + 0.12, y: 1.58, w: 1.56, h: 0.28, fontFace: FONT, fontSize: 10, color: i === 2 ? "B8C4DA" : C.gray, margin: 0, isTextBox: true });
        s.addText(`${fmtNum(f.members)}명`, { x: x + 0.12, y: 1.88, w: 1.56, h: 0.55, fontFace: FONT, fontSize: 20, bold: true, color: i === 2 ? C.white : C.navy, margin: 0, valign: "middle", fit: "shrink", isTextBox: true });
        s.addText(`결제액 비중 ${fmtPct(f.amountShare)}`, { x: x + 0.12, y: 2.5, w: 1.56, h: 0.4, fontFace: FONT, fontSize: 9, color: i === 2 ? C.mint : C.mintDark, bold: true, margin: 0, isTextBox: true });
      });
      card(pres, s, 6.3, 1.5, 3.2, 1.55);
      sectionLabel(s, "파레토 (당월 결제액 쏠림)", 6.45, 1.58, 3);
      s.addText(b.pareto ? `상위 10% 회원이\n매출의 ${fmtPct(b.pareto.top10Share)}` : "-", { x: 6.45, y: 1.88, w: 2.9, h: 0.6, fontFace: FONT, fontSize: 13, bold: true, color: C.navy, margin: 0, valign: "top", isTextBox: true });
      s.addText(b.pareto ? `상위 20%는 ${fmtPct(b.pareto.top20Share)}` : "", { x: 6.45, y: 2.55, w: 2.9, h: 0.3, fontFace: FONT, fontSize: 9, color: C.gray, margin: 0, isTextBox: true });
      sectionLabel(s, "재구매 · 리텐션", 0.5, 3.2, 5);
      stat(pres, s, 0.5, 3.5, 2.9, 1.55, "전월 구매자의 재구매율", b.retention ? fmtPct(b.retention.rate) : "-", b.retention ? `전월 ${fmtNum(b.retention.prevBuyers)}명 중 ${fmtNum(b.retention.repurchased)}명이 당월 재구매` : "전월 집계가 없어 계산 불가");
      stat(pres, s, 3.55, 3.5, 2.9, 1.55, "전월 신규 구매자의 재구매율", b.newBuyerRetention ? fmtPct(b.newBuyerRetention.rate) : "-", b.newBuyerRetention ? `전월 신규 ${fmtNum(b.newBuyerRetention.newPrev)}명 중 ${fmtNum(b.newBuyerRetention.retained)}명 재구매` : "3개월 집계가 필요합니다");
      stat(pres, s, 6.6, 3.5, 2.9, 1.55, "당월 신규 구매자", b.newBuyers != null ? `${fmtNum(b.newBuyers)}명` : "-", b.orders != null && b.buyers ? `구매 회원 평균 ${(b.orders / Math.max(1, b.buyers)).toFixed(1)}회 · ${fmtWon(Math.round((b.amount ?? 0) / Math.max(1, b.buyers)))}` : undefined);
    }
  }

  // 10. 쿠폰·이벤트 ───────────────────────────────────────────────────────
  // 쿠폰·이벤트 둘 다 수집되지 않았으면 슬라이드를 만들지 않습니다.
  if (model.members.coupons || model.members.events) {
    const mb = model.members;
    const s = frame(pres, model, "05", "멤버십 · 고객 지표 (쿠폰 · 이벤트)", "혜택 운영 현황");
    // 발급은 많은데 사용 0건이면 CMS가 사용 건수를 집계하지 못한 경우가 많아 0건 대신 "-"로 표시합니다.
    const usageMissing = !!mb.coupons && mb.coupons.issued > 0 && mb.coupons.used === 0;
    if (mb.coupons) {
      stat(pres, s, 0.5, 1.2, 2.1, 1.1, "쿠폰 발급", `${fmtNum(mb.coupons.issued)}건`);
      stat(pres, s, 2.7, 1.2, 2.1, 1.1, "쿠폰 사용", usageMissing ? "-" : `${fmtNum(mb.coupons.used)}건`, usageMissing ? "CMS 사용 집계 없음" : `사용률 ${fmtPct(mb.coupons.rate)}`);
      stat(pres, s, 4.9, 1.2, 2.1, 1.1, "쿠폰 할인액", usageMissing ? "-" : fmtWon(mb.coupons.dcAmt));
    } else empty(s, 0.5, 1.2, 6.5, 1.1, "쿠폰 통계를 수집하지 못했습니다");
    stat(pres, s, 7.1, 1.2, 2.4, 1.1, "진행 중 이벤트", mb.events ? `${fmtNum(mb.events.running)}개` : "-", mb.events ? `전체 ${mb.events.total}개 등록` : undefined);
    sectionLabel(s, "쿠폰 사용 TOP 5 매장", 0.5, 2.5, 4.3);
    if (mb.coupons && mb.coupons.topStores.length > 0) {
      table(pres, s, 0.5, 2.8, 4.5, [2.1, 0.8, 0.8, 0.8], ["매장", "발급", "사용", "사용률"], mb.coupons.topStores.map((r) => [r.name, fmtNum(r.issued), fmtNum(r.used), fmtPct(r.rate)]), { fontSize: 8.5, rowH: 0.3 });
    } else empty(s, 0.5, 2.9, 4.5, 2);
    sectionLabel(s, "진행 중 이벤트", 5.3, 2.5, 4.3);
    if (mb.events && mb.events.list.length > 0) {
      table(pres, s, 5.3, 2.8, 4.2, [1.9, 0.7, 1.6], ["이벤트", "유형", "기간"], mb.events.list.slice(0, 6).map((e) => [e.name, e.type, e.period.replace(/-/g, ".")]), { fontSize: 8, rowH: 0.3, align: ["left", "center", "left"] });
    } else empty(s, 5.3, 2.9, 4.2, 2, "진행 중인 이벤트가 없습니다");
  }

  // 11. 익월 목표·액션 ─────────────────────────────────────────────────────
  {
    const p = model.plan;
    const s = frame(pres, model, "06", "익월 목표 및 액션 아이템", "다음 달 목표와 전월 액션 이행 점검");
    sectionLabel(s, "익월 목표", 0.5, 1.2, 4.3);
    if (p.goals.length > 0) table(pres, s, 0.5, 1.5, 4.4, [2.0, 2.4], ["지표", "목표"], p.goals.slice(0, 5).map((g) => [g.metric, g.target]), { fontSize: 9, rowH: 0.3, align: ["left", "left"] });
    else empty(s, 0.5, 1.6, 4.4, 1.3, "입력된 목표가 없습니다");
    sectionLabel(s, "익월 액션 아이템", 5.1, 1.2, 4.3);
    if (p.actions.length > 0) table(pres, s, 5.1, 1.5, 4.4, [2.3, 1.0, 1.1], ["액션", "담당", "기한"], p.actions.slice(0, 5).map((a) => [a.title, a.owner, a.due.replace(/-/g, ".")]), { fontSize: 9, rowH: 0.3, align: ["left", "left", "left"] });
    else empty(s, 5.1, 1.6, 4.4, 1.3, "입력된 액션이 없습니다");
    sectionLabel(s, p.prevReview.length > 0 ? "전월 액션 이행 점검" : "제안 액션 (데이터 기반)", 0.5, 3.35, 5);
    if (p.prevReview.length > 0) {
      const st = { DONE: "완료", PARTIAL: "일부 진행", TODO: "미진행" } as const;
      table(pres, s, 0.5, 3.65, 9, [4.0, 1.2, 3.8], ["액션", "상태", "코멘트"], p.prevReview.slice(0, 4).map((r) => [r.title, st[r.status], r.comment]), { fontSize: 9, rowH: 0.3, align: ["left", "center", "left"] });
    } else if (p.suggestions.length > 0) {
      s.addText(p.suggestions.slice(0, 4).map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1 } })), { x: 0.5, y: 3.65, w: 9, h: 1.4, fontFace: FONT, fontSize: 9.5, color: C.ink, margin: 0, valign: "top", paraSpaceAfter: 3, fit: "shrink", isTextBox: true });
    } else empty(s, 0.5, 3.7, 9, 1.3, "전월 액션 기록이 없습니다");
    if (p.note) s.addNotes(p.note);
  }

  // 12. 데이터 체크리스트 ──────────────────────────────────────────────────
  {
    const s = frame(pres, model, "07", "데이터 체크리스트", "이 리포트의 수치가 어떤 데이터에 근거하는지");
    const rows = model.checklist.map((c) => [c.skipped ? "제외" : c.ok ? "확인" : "점검 필요", c.item, c.note]);
    table(pres, s, 0.5, 1.25, 9, [1.1, 3.1, 4.8], ["상태", "항목", "비고"], rows, { fontSize: 8.5, rowH: 0.31, align: ["center", "left", "left"], cellColor: (t, c) => (c === 0 ? (t === "확인" ? C.good : t === "제외" ? C.gray : C.warn) : undefined) });
  }

  const out = (await pres.write({ outputType: "nodebuffer" })) as unknown as Buffer;
  return Buffer.from(out);
}
