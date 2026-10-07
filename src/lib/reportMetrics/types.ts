// 리포트 지표 계산 모듈의 입출력 타입. 계산 로직은 전부 순수 함수(buildReportModel 등)라서
// 서버(API)와 클라이언트(화면④ 미리보기)가 같은 코드를 씁니다.

import type { BrandFeeDefaults } from "@/lib/types";
import type { MonthBreakdown } from "@/lib/cmsAutomation/collectExtras";
import type { GrowthSplit, MenuChange } from "./breakdownMetrics";

// ── 월별 요약(과거 월 비교용, 문서 1건에서 뽑은 작은 스냅샷) ─────────────────────
export interface MonthSnapshot {
  yearMonth: string;
  hasExtras: boolean; // 앱/전체 구분 데이터(collectExtras)가 있는 달인지 — 없으면 정산 데이터로 앱결제액만 추정
  totalPay: number | null; // 전체 매출액(온라인+오프라인)
  onlinePay: number | null;
  offlinePay: number | null;
  appPay: number | null; // 그로스잇 매출액(앱결제액)
  appOrders: number | null;
  appShare: number | null; // %
  appDeliveryPay: number | null;
  appPickupPay: number | null;
  appStorePay: number | null;
  members: number | null;
  newMembers: number | null;
}

// ── 회원 구매 집계(서버가 brandMonthlyMembers에서 계산) ────────────────────────
export interface FrequencyBand {
  threshold: number; // 3개월 합산 주문 수 ≥ threshold
  members: number;
  amountShare: number; // 그 회원들의 결제액이 3개월 앱결제액에서 차지하는 비중(%)
}
export interface MemberMetrics {
  months: string[]; // 집계에 쓴 연월(오름차순)
  buyers: number | null; // 당월 구매 회원 수
  orders: number | null;
  amount: number | null;
  frequency: FrequencyBand[] | null; // 3개월 합산 기준, 데이터가 1~2개월뿐이면 그 기간 기준
  frequencyMonths: string[];
  pareto: { top10Share: number; top20Share: number } | null;
  retention: { prevBuyers: number; repurchased: number; rate: number } | null; // 전월 구매자 중 당월 재구매
  newBuyers: number | null; // 당월 첫 구매(직전 집계 월들에 없던 회원)
  newBuyerRetention: { newPrev: number; retained: number; rate: number } | null; // 전월 신규 구매자 중 당월 재구매
  truncated: boolean;
}

// ── 화면④ 담당자 입력(brandMonthlyData.overrides) ────────────────────────────
export interface GoalItem {
  metric: string;
  target: string;
}
export interface ActionItem {
  title: string;
  owner: string;
  due: string;
}
export interface ActionReview {
  title: string;
  status: "DONE" | "PARTIAL" | "TODO";
  comment: string;
}
export interface ReportOverrides {
  fee_delivery_rate?: number | null;
  fee_pickup_rate?: number | null;
  benchmark_rate?: number | null;
  next_goals?: GoalItem[];
  actions?: ActionItem[];
  prev_review?: ActionReview[];
  note?: string;
}

export interface ReportInput {
  brandName: string;
  companyName: string;
  yearMonth: string;
  feeDefaults: BrandFeeDefaults | null;
  current: Record<string, unknown>; // brandMonthlyData.data 원본(extras 포함)
  history: MonthSnapshot[]; // 당월 이전 월(오름차순, 최대 5개)
  members: MemberMetrics | null;
  overrides: ReportOverrides;
  prevActions: ActionItem[]; // 전월 리포트에 담당자가 적었던 "익월 액션" — 이번 달 이행 점검용
  breakdowns?: { cur: MonthBreakdown | null; prev: MonthBreakdown | null; prev2: MonthBreakdown | null }; // 매장·메뉴 전체 목록(당월·전월·전전월)
  prevDaily?: { date: string; amount: number; orders: number }[]; // 전월 일별 앱 매출(일평균·일별 추이 비교용, 없으면 생략)
  generatedAt: number;
}

// ── 결과 ────────────────────────────────────────────────────────────────────
export interface Kpi {
  key: string;
  label: string;
  unit: "원" | "건" | "명" | "%" | "개";
  value: number | null;
  prev: number | null;
  // 전월 대비. unit이 "%"인 지표(앱 비중)는 %p 차이, 나머지는 증감률(%). 전월 스냅샷이 없으면 CMS가 준 MoM을 씁니다.
  pct: number | null;
  pctSource: "CALC" | "CMS" | null;
}

export interface ReportModel {
  meta: { brandName: string; companyName: string; yearMonth: string; prevYearMonth: string; generatedAt: number };
  summary: { kpis: Kpi[]; headlines: string[] };
  sales: {
    totalPay: number | null;
    onlinePay: number | null;
    offlinePay: number | null;
    totalOrders: number | null;
    appPay: number | null;
    appOrders: number | null;
    appShare: number | null;
    byOrderType: { label: string; pay: number; orders: number }[]; // 앱 주문 유형별
    trend: { yearMonth: string; appPay: number | null; appShare: number | null; totalPay: number | null }[];
    daily: { date: string; amount: number; orders: number }[];
    prevDaily: { date: string; amount: number; orders: number }[];
    // 일평균 기준 지표 — 월 일수(28~31일)가 달라 월 합계만 비교하면 생기는 착시를 줄입니다.
    dailyAvg: { days: number; prevDays: number | null; items: { key: string; label: string; unit: "원" | "건" | "명"; value: number | null; prev: number | null; pct: number | null }[] } | null;
    dow: { label: string; orders: number; amount: number }[];
    hours: number[];
    ordersTruncated: boolean;
    ordersSampled: boolean; // 대형 브랜드: 일부 주문만 읽어 늘린 추정치
  };
  channel: {
    channels: { name: string; pay: number; orders: number; share: number }[];
    fee: {
      deliveryRate: number | null;
      pickupRate: number | null;
      benchmarkRate: number;
      deliveryPay: number | null;
      pickupPay: number | null;
      growthitFee: number | null; // 그로스잇 수수료 합계
      benchmarkFee: number | null; // 같은 매출을 배달앱으로 팔았다면 냈을 수수료
      saving: number | null; // 절감액 = benchmarkFee − growthitFee
      roi: number | null; // 절감액 ÷ 그로스잇 수수료 × 100
      missingFee: boolean;
    };
    cumulative: { months: number; saving: number; fee: number; roi: number | null } | null;
    savingTrend: { yearMonth: string; saving: number }[];
  };
  stores: {
    counts: { total: number; normal: number; temporaryClosed: number; closed: number; preOpen: number };
    notAdopted: number; // 노출여부=미노출 AND 매장상태=개점전
    appStores: number; // 앱 매출이 있는 매장 수
    adoptionRate: number | null; // 앱 매출 매장 ÷ 정상 매장 (%)
    newStores: { before15: number; after15: number } | null;
    top: { name: string; appPay: number; appShare: number | null; orders: number }[];
    bottom: { name: string; appPay: number; appShare: number | null; orders: number }[];
  };
  members: {
    total: number | null;
    totalPrev: number | null;
    newMembers: number | null;
    segments: { label: string; count: number; rate: number }[];
    levels: { label: string; count: number; rate: number }[];
    topItems: { name: string; appPay: number; orders: number }[];
    gender: { label: string; pay: number; share: number }[];
    ages: { label: string; pay: number; share: number }[];
    buyers: MemberMetrics | null;
    visitors: { total: number; aos: number; ios: number; avgDaily: number } | null;
    coupons: { issued: number; used: number; rate: number; dcAmt: number; topStores: { name: string; issued: number; used: number; rate: number }[] } | null;
    events: { running: number; total: number; list: { name: string; type: string; period: string }[] } | null;
  };
  plan: {
    goals: GoalItem[];
    actions: ActionItem[];
    prevReview: ActionReview[];
    suggestions: string[];
    note: string;
  };
  // skipped=true: 데이터 한계로 일부러 리포트에서 제외한 항목(점검 필요가 아니라 "제외"로 표시)
  // 매장·메뉴 전체 목록이 있을 때만 값이 채워집니다(없으면 null — 리포트에서 해당 섹션을 생략).
  growth: GrowthSplit | null;
  menuChange: MenuChange | null;
  checklist: { item: string; ok: boolean; note: string; skipped?: boolean }[];
}
