// 수집 데이터 + 담당자 입력 → 리포트 8개 섹션 값(ReportModel). 순수 함수입니다.
// 매출 기준(전체=온라인+오프라인, 그로스잇 매출액=우리가잇다 앱결제액, 앱 비중=앱÷전체)은 salesBasis.ts의
// 담당자 확정 정의를 그대로 따릅니다. 서비스이용료 세부 내역은 리포트에서 쓰지 않습니다(2026-10-05 결정).

import type { CmsExtras, SalesRow } from "@/lib/cmsAutomation/collectExtras";
import { DEFAULT_BENCHMARK_FEE_RATE } from "@/lib/types";
import { fmtPct, fmtSigned, fmtWon, monthShort } from "./format";
import { computeSalesBasis } from "./salesBasis";
import { snapshotFromData } from "./snapshot";
import type { ActionItem, ActionReview, Kpi, MonthSnapshot, ReportInput, ReportModel } from "./types";
import { arr, num, numOrNull, pctChange, prevMonth, rec, round1, round2, str } from "./util";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function pick(override: number | null | undefined, fallback: number | null | undefined): number | null {
  // 비워 둔 값(null)은 "입력 없음"이므로 브랜드 기본값을 씁니다. 수수료 없음은 0으로 입력합니다.
  return override ?? fallback ?? null;
}

interface FeeCalc {
  growthitFee: number | null;
  benchmarkFee: number | null;
  saving: number | null;
  roi: number | null;
  missingFee: boolean;
}
function calcFee(
  appPay: number | null,
  deliveryPay: number | null,
  pickupPay: number | null,
  deliveryRate: number | null,
  pickupRate: number | null,
  benchmark: number
): FeeCalc {
  const benchmarkFee = appPay == null ? null : Math.round((appPay * benchmark) / 100);
  const missing = ((deliveryPay ?? 0) > 0 && deliveryRate == null) || ((pickupPay ?? 0) > 0 && pickupRate == null);
  if (appPay == null || deliveryPay == null || pickupPay == null || missing) {
    return { growthitFee: null, benchmarkFee, saving: null, roi: null, missingFee: missing };
  }
  const fee = Math.round((deliveryPay * (deliveryRate ?? 0)) / 100 + (pickupPay * (pickupRate ?? 0)) / 100);
  const saving = (benchmarkFee ?? 0) - fee;
  return { growthitFee: fee, benchmarkFee, saving, roi: fee > 0 ? round1((saving / fee) * 100) : null, missingFee: false };
}

function mergeItems(rows: SalesRow[]) {
  const map = new Map<string, { name: string; appPay: number; orders: number }>();
  for (const r of rows) {
    if (r.name === "전체") continue;
    const cur = map.get(r.name) ?? { name: r.name, appPay: 0, orders: 0 };
    cur.appPay += r.app?.total.pay ?? 0;
    cur.orders += r.app?.total.ord ?? 0;
    map.set(r.name, cur);
  }
  return Array.from(map.values())
    .filter((x) => x.appPay > 0)
    .sort((a, b) => b.appPay - a.appPay);
}

export function buildReportModel(input: ReportInput): ReportModel {
  const { yearMonth, overrides } = input;
  const prevYm = prevMonth(yearMonth);
  const data = input.current;
  const extras = (data.extras ?? null) as CmsExtras | null;
  const basis = computeSalesBasis(extras);
  const dash = rec(data.dashboard);
  const cur = snapshotFromData(yearMonth, data);
  const prev: MonthSnapshot | null = input.history.find((h) => h.yearMonth === prevYm) ?? null;

  // ── 수수료 ──
  const deliveryRate = pick(overrides.fee_delivery_rate, input.feeDefaults?.delivery_rate);
  const pickupRate = pick(overrides.fee_pickup_rate, input.feeDefaults?.pickup_rate);
  const benchmark = pick(overrides.benchmark_rate, input.feeDefaults?.benchmark_rate) ?? DEFAULT_BENCHMARK_FEE_RATE;
  const fee = calcFee(cur.appPay, cur.appDeliveryPay, cur.appPickupPay, deliveryRate, pickupRate, benchmark);
  const prevFee = prev ? calcFee(prev.appPay, prev.appDeliveryPay, prev.appPickupPay, deliveryRate, pickupRate, benchmark) : null;

  // ── KPI ──
  const cmsMom = (key: string): number | null => {
    const v = numOrNull(rec(dash[key]).mom);
    return v == null || v <= -100 ? null : v; // -101 등 CMS가 비교 불가를 뜻하는 값은 버립니다
  };
  const mk = (
    key: string,
    label: string,
    unit: Kpi["unit"],
    value: number | null,
    prevVal: number | null,
    cmsKey?: string
  ): Kpi => {
    if (unit === "%") {
      const diff = value != null && prevVal != null ? round1(value - prevVal) : null;
      return { key, label, unit, value, prev: prevVal, pct: diff, pctSource: diff == null ? null : "CALC" };
    }
    const calc = pctChange(value, prevVal);
    if (calc != null) return { key, label, unit, value, prev: prevVal, pct: calc, pctSource: "CALC" };
    const cms = cmsKey ? cmsMom(cmsKey) : null;
    return { key, label, unit, value, prev: prevVal, pct: cms, pctSource: cms == null ? null : "CMS" };
  };
  const kpis: Kpi[] = [
    mk("totalPay", "전체 매출액", "원", cur.totalPay, prev?.totalPay ?? null),
    mk("appPay", "그로스잇 매출액(앱결제액)", "원", cur.appPay, prev?.appPay ?? null, "totalPayment"),
    mk("appShare", "앱 비중", "%", cur.appShare, prev?.appShare ?? null),
    mk("appOrders", "앱 주문 수", "건", cur.appOrders, prev?.appOrders ?? null, "totalOrderCnt"),
    mk("members", "전체 회원 수", "명", cur.members, prev?.members ?? null, "totalMemberCnt"),
    mk("newMembers", "신규 회원 수", "명", cur.newMembers, prev?.newMembers ?? null, "totalNewMemberCnt"),
    mk("saving", "절감액(배달앱 대비)", "원", fee.saving, prevFee?.saving ?? null),
  ];
  const kpi = (k: string) => kpis.find((x) => x.key === k)!;

  const mLabel = monthShort(yearMonth);
  const headlines: string[] = [];
  if (cur.appPay != null) {
    const p = kpi("appPay").pct;
    headlines.push(`${mLabel} 그로스잇 매출액은 ${fmtWon(cur.appPay)}${p != null ? `으로 전월 대비 ${fmtSigned(p)}` : ""}입니다.`);
  }
  if (cur.appShare != null && cur.totalPay != null) {
    headlines.push(`전체 매출 ${fmtWon(cur.totalPay)} 중 앱 비중은 ${fmtPct(cur.appShare, 2)}입니다.`);
  }
  if (fee.saving != null) {
    headlines.push(`배달앱 수수료(${benchmark}%) 대비 ${fmtWon(fee.saving)}을 절감했습니다${fee.roi != null ? ` (ROI ${fee.roi.toLocaleString("ko-KR")}%)` : ""}.`);
  }
  if (cur.members != null) {
    headlines.push(`전체 회원 ${cur.members.toLocaleString("ko-KR")}명, 신규 ${(cur.newMembers ?? 0).toLocaleString("ko-KR")}명입니다.`);
  }

  // ── 매출·GMV ──
  const totalRow = extras?.salesStore?.find((r) => r.name === "전체") ?? extras?.salesStore?.[0] ?? null;
  const app = totalRow?.app ?? null;
  const byOrderType = app
    ? [
        { label: "픽업", pay: app.pickup.pay, orders: app.pickup.ord },
        { label: "배달", pay: app.delivery.pay, orders: app.delivery.ord },
        { label: "매장", pay: app.store.pay, orders: app.store.ord },
        { label: "예약", pay: app.reserve.pay, orders: app.reserve.ord },
      ].filter((x) => x.pay > 0 || x.orders > 0)
    : [];
  const trendBase = [...input.history, cur].slice(-6);
  const trend = trendBase.map((s) => ({ yearMonth: s.yearMonth, appPay: s.appPay, appShare: s.appShare, totalPay: s.totalPay }));
  const daily = arr(dash.recentSalesList)
    .map(rec)
    .filter((r) => str(r.yyyymmdd).startsWith(yearMonth) && (r.storeId === undefined || r.storeId === 0))
    .map((r) => ({ date: str(r.yyyymmdd), amount: num(r.totalSalesAmt), orders: num(r.orderCnt) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const ord = extras?.orders ?? null;
  const dow = ord ? DOW.map((label, i) => ({ label, orders: ord.byDow[i] ?? 0, amount: ord.byDowAmount[i] ?? 0 })) : [];

  // ── 채널 효율 ──
  const channels = (extras?.onlineChannels ?? [])
    .map((c) => ({ name: c.name, pay: c.split.total.pay, orders: c.split.total.ord, share: c.share }))
    .filter((c) => c.pay > 0 || c.orders > 0)
    .sort((a, b) => b.pay - a.pay);
  const savingTrend: { yearMonth: string; saving: number }[] = [];
  let cumSaving = 0;
  let cumFee = 0;
  for (const s of trendBase) {
    if (!s.hasExtras) continue;
    const f = calcFee(s.appPay, s.appDeliveryPay, s.appPickupPay, deliveryRate, pickupRate, benchmark);
    if (f.saving == null || f.growthitFee == null) continue;
    cumSaving += f.saving;
    cumFee += f.growthitFee;
    savingTrend.push({ yearMonth: s.yearMonth, saving: f.saving });
  }
  const cumulative =
    savingTrend.length > 0
      ? { months: savingTrend.length, saving: cumSaving, fee: cumFee, roi: cumFee > 0 ? round1((cumSaving / cumFee) * 100) : null }
      : null;

  // ── 매장 운영 ──
  const storeList = arr(rec(data.storeManage).list).map(rec);
  const countSt = (st: string) => storeList.filter((s) => str(s.storeSt) === st).length;
  const normal = countSt("350001");
  const storeRows = (extras?.salesStore ?? []).filter((r) => r.name !== "전체");
  const withApp = storeRows
    .filter((r) => (r.app?.total.pay ?? 0) > 0)
    .map((r) => ({
      name: r.name,
      appPay: r.app?.total.pay ?? 0,
      appShare: r.all.total.pay > 0 ? round1(((r.app?.total.pay ?? 0) / r.all.total.pay) * 100) : null,
      orders: r.app?.total.ord ?? 0,
    }));
  const topSorted = [...withApp].sort((a, b) => b.appPay - a.appPay);
  const brandSet = extras?.dailyBrandSet ?? null;

  // ── 멤버십·고객 ──
  const target = rec(dash.target);
  const segDefs: [string, string][] = [
    ["충성 고객", "regularCusCnt"],
    ["활동 고객", "activeCusCnt"],
    ["활동 하락 고객", "deactiveCusCnt"],
    ["미활동 고객", "nonactiveCusCnt"],
  ];
  const segTotal = segDefs.reduce((s, [, k]) => s + num(target[k]), 0);
  const segments = segTotal > 0 ? segDefs.map(([label, k]) => ({ label, count: num(target[k]), rate: round1((num(target[k]) / segTotal) * 100) })) : [];

  const msList = arr(rec(data.memberStats).list).map(rec);
  const msRow = msList.find((r) => str(r.cusGender) === "" && str(r.cusAges) === "") ?? msList[0] ?? null;
  const levels: { label: string; count: number; rate: number }[] = [];
  if (msRow) {
    for (let i = 1; i <= 10; i++) {
      const c = num(msRow[`cusLevelCnt${i}`]);
      if (c > 0) levels.push({ label: `등급 ${i}`, count: c, rate: round2(num(msRow[`cusLevelRat${i}`])) });
    }
  }

  const topItems = mergeItems(extras?.salesItem ?? []).slice(0, 10);

  const gaRows = (extras?.salesGenderAge ?? []).map((r) => {
    const [g = "", a = ""] = r.name.split(" ");
    return { g, a, pay: r.all.total.pay };
  });
  const genderRows = gaRows.filter((r) => r.a === "전체" && r.g !== "전체" && r.g !== "");
  const genderSum = genderRows.reduce((s, r) => s + r.pay, 0);
  const gender = genderRows.map((r) => ({ label: r.g, pay: r.pay, share: genderSum > 0 ? round1((r.pay / genderSum) * 100) : 0 }));
  const ageMap = new Map<string, number>();
  for (const r of gaRows) if (r.a !== "전체" && r.a !== "" && r.g !== "전체") ageMap.set(r.a, (ageMap.get(r.a) ?? 0) + r.pay);
  const ageSum = Array.from(ageMap.values()).reduce((s, v) => s + v, 0);
  const ages = Array.from(ageMap.entries())
    .map(([label, pay]) => ({ label, pay, share: ageSum > 0 ? round1((pay / ageSum) * 100) : 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));

  const vis = extras?.visitors ?? null;
  const visitors = vis && vis.length > 0
    ? (() => {
        const inMonth = vis.filter((v) => v.date.replace(/-/g, "").startsWith(yearMonth.replace("-", "")));
        const rows = inMonth.length > 0 ? inMonth : vis;
        const total = rows.reduce((s, v) => s + v.total, 0);
        return { total, aos: rows.reduce((s, v) => s + v.aos, 0), ios: rows.reduce((s, v) => s + v.ios, 0), avgDaily: Math.round(total / rows.length) };
      })()
    : null;

  const cp = extras?.coupons?.find((c) => c.couponGb === null) ?? null;
  const coupons = cp
    ? {
        issued: cp.issued,
        used: cp.used,
        rate: cp.rate,
        dcAmt: cp.dcAmt,
        topStores: (extras?.couponsByStore ?? [])
          .filter((c) => c.storeId !== null && c.issued > 0)
          .sort((a, b) => b.used - a.used)
          .slice(0, 5)
          .map((c) => ({ name: c.storeNm, issued: c.issued, used: c.used, rate: c.rate })),
      }
    : null;

  const evAll = extras?.events ?? null;
  const events = evAll
    ? (() => {
        const running = evAll.filter((e) => e.state.includes("진행"));
        return {
          running: running.length,
          total: evAll.length,
          list: running.slice(0, 8).map((e) => ({ name: e.eventNm, type: e.eventTpNm, period: `${e.startDt} ~ ${e.endDt}` })),
        };
      })()
    : null;

  // ── 익월 목표·액션 ──
  const prevReview: ActionReview[] = input.prevActions.map((a: ActionItem) => {
    const found = (overrides.prev_review ?? []).find((r) => r.title === a.title);
    return found ?? { title: a.title, status: "TODO", comment: "" };
  });
  const suggestions: string[] = [];
  const notAdopted = storeList.filter((s) => num(s.displayYn) === 0 && str(s.storeSt) === "350004").length;
  if (cur.appShare != null && cur.appShare < 10) suggestions.push(`앱 비중이 ${fmtPct(cur.appShare, 2)}로 낮습니다 — 오프라인 고객의 앱 전환(앱 전용 쿠폰·스탬프 적립 안내)을 우선 과제로 두세요.`);
  if (notAdopted > 0) suggestions.push(`앱 미도입 매장이 ${notAdopted}곳입니다 — 오픈 일정 확정과 매장 교육 일정을 잡으세요.`);
  const nonactive = segments.find((s) => s.label === "미활동 고객");
  if (nonactive && nonactive.rate >= 50) suggestions.push(`미활동 고객이 ${nonactive.rate}%입니다 — 휴면 회원 리마인드 푸시·쿠폰 캠페인을 검토하세요.`);
  if (coupons && coupons.issued > 0 && coupons.rate < 25) suggestions.push(`쿠폰 사용률이 ${coupons.rate}%입니다 — 쿠폰 유효기간·발급 대상을 점검하세요.`);
  if (input.members?.retention && input.members.retention.rate < 40) suggestions.push(`전월 구매자의 재구매율이 ${input.members.retention.rate}%입니다 — 재구매 유도(스탬프·등급 혜택) 프로모션을 검토하세요.`);
  if (fee.missingFee) suggestions.push("그로스잇 수수료율이 입력되지 않아 절감액을 계산하지 못했습니다 — 브랜드 설정에서 배달·픽업 수수료율을 입력하세요.");

  // ── 데이터 체크리스트 ──
  const members = input.members;
  const checklist: ReportModel["checklist"] = [
    { item: "앱·전체 매출 구분(매장별 매출통계)", ok: !!basis, note: basis ? "수집됨" : "수집 실패 — 전체 매출·앱 비중을 계산할 수 없습니다" },
    { item: "온라인 채널별 매출(배달앱 비교)", ok: channels.length > 0, note: channels.length > 0 ? `${channels.length}개 채널` : "수집 실패" },
    { item: "메뉴·성별/연령 매출", ok: topItems.length > 0 && gender.length > 0, note: topItems.length > 0 ? "수집됨" : "수집 실패 또는 앱 매출 없음" },
    { item: "주문 단위 집계(요일·시간대)", ok: !!ord && (!ord.truncated || !!ord.sampled), note: !ord ? "수집 실패" : ord.sampled ? `월 ${(ord.totalCnt ?? 0).toLocaleString("ko-KR")}건 중 일부(${ord.pagesRead}페이지)를 읽어 전체로 늘린 추정치` : ord.truncated ? "시간/페이지 상한으로 일부만 집계됨" : `${ord.orderCount.toLocaleString("ko-KR")}건 전체 집계` },
    { item: "회원 구매 집계(빈도·재구매·파레토)", ok: (!!members && !members.truncated) || (!members && !!ord?.sampled), note: !members ? (ord?.sampled ? "월 주문이 매우 많은 브랜드라 표본으로는 정확하지 않아 제공하지 않음" : "집계 데이터 없음(수집 전 월이거나 저장 실패)") : `${members.months.join(", ")} 기준${members.truncated ? " (일부만 집계)" : ""}` },
    { item: "전월 비교 데이터", ok: !!prev, note: prev ? `${prevYm} 데이터로 계산` : `${prevYm} 데이터 없음 — CMS가 준 전월 대비 값을 대신 씁니다` },
    { item: "방문자·쿠폰·이벤트", ok: !!visitors && !!coupons && !!events, note: visitors && coupons && events ? "수집됨" : "일부 수집 실패" },
    { item: "그로스잇 수수료율(배달·픽업)", ok: !fee.missingFee && deliveryRate !== null && pickupRate !== null, note: fee.missingFee ? "미입력 — 절감액 계산 불가" : deliveryRate === null || pickupRate === null ? "일부 미입력(해당 유형 매출이 없어 계산에는 영향 없음)" : "입력됨" },
    { item: "정산 데이터 경로", ok: str(data.settlementSource) !== "EXCEL_FALLBACK", note: str(data.settlementSource) === "EXCEL_FALLBACK" ? "CMS 정산 조회 지연으로 엑셀 경로 사용 — 일부 값이 CMS 화면과 다를 수 있음" : "JSON" },
    { item: "익월 목표·액션 입력", ok: (overrides.next_goals?.length ?? 0) > 0 || (overrides.actions?.length ?? 0) > 0, note: "화면④에서 입력" },
  ];

  return {
    meta: { brandName: input.brandName, companyName: input.companyName, yearMonth, prevYearMonth: prevYm, generatedAt: input.generatedAt },
    summary: { kpis, headlines },
    sales: {
      totalPay: cur.totalPay,
      onlinePay: cur.onlinePay,
      offlinePay: cur.offlinePay,
      totalOrders: totalRow?.all.total.ord ?? null,
      appPay: cur.appPay,
      appOrders: cur.appOrders,
      appShare: cur.appShare,
      byOrderType,
      trend,
      daily,
      dow,
      hours: ord?.byHour ?? [],
      ordersTruncated: ord?.truncated ?? false,
      ordersSampled: ord?.sampled ?? false,
    },
    channel: {
      channels,
      fee: {
        deliveryRate,
        pickupRate,
        benchmarkRate: benchmark,
        deliveryPay: cur.appDeliveryPay,
        pickupPay: cur.appPickupPay,
        growthitFee: fee.growthitFee,
        benchmarkFee: fee.benchmarkFee,
        saving: fee.saving,
        roi: fee.roi,
        missingFee: fee.missingFee,
      },
      cumulative,
      savingTrend,
    },
    stores: {
      counts: { total: storeList.length, normal, temporaryClosed: countSt("350002"), closed: countSt("350003"), preOpen: countSt("350004") },
      notAdopted,
      // 매장이 많은 브랜드는 저장된 매장 행이 상·하위 일부뿐이라(salesStoreMeta), 개수는 수집 때 센 전체 값을 씁니다.
      appStores: extras?.salesStoreMeta?.withAppStores ?? withApp.length,
      adoptionRate: normal > 0 ? round1(((extras?.salesStoreMeta?.withAppStores ?? withApp.length) / normal) * 100) : null,
      newStores: brandSet ? { before15: num(brandSet.newStoreAgo15Day), after15: num(brandSet.newStoreAfter15Day) } : null,
      top: topSorted.slice(0, 10),
      bottom: [...withApp].sort((a, b) => a.appPay - b.appPay).slice(0, 5),
    },
    members: {
      total: cur.members,
      totalPrev: prev?.members ?? null,
      newMembers: cur.newMembers,
      segments,
      levels,
      topItems,
      gender,
      ages,
      buyers: members,
      visitors,
      coupons,
      events,
    },
    plan: {
      goals: overrides.next_goals ?? [],
      actions: overrides.actions ?? [],
      prevReview,
      suggestions,
      note: overrides.note ?? "",
    },
    checklist,
  };
}
