// 서버 전용: Firestore에 저장된 월 데이터·회원 집계·담당자 입력을 모아 ReportInput을 만듭니다.
// 화면④ 미리보기(GET)와 PPT 발행(POST)이 같은 입력을 쓰도록 한곳에 둡니다.

import type { Firestore } from "firebase-admin/firestore";
import { loadMemberAggregates } from "@/lib/cmsAutomation/memberAggStore";
import type { BrandMonthlyData, ReportBrand } from "@/lib/types";
import { computeMemberMetrics, type MonthMembers } from "./memberMetrics";
import { snapshotFromData } from "./snapshot";
import type { ActionItem, ReportInput, ReportOverrides } from "./types";
import { monthsBefore } from "./util";
import { loadBreakdown } from "@/lib/cmsAutomation/breakdownStore";

export class ReportDataMissingError extends Error {}

const HISTORY_MONTHS = 5;

export async function loadReportInput(db: Firestore, brand: ReportBrand, yearMonth: string): Promise<ReportInput> {
  const brandId = brand.id;
  const curSnap = await db.collection("brandMonthlyData").doc(`${brandId}_${yearMonth}`).get();
  if (!curSnap.exists) {
    throw new ReportDataMissingError(`${yearMonth} 데이터가 아직 수집되지 않았습니다. 먼저 데이터를 수집해주세요.`);
  }
  const cur = curSnap.data() as BrandMonthlyData;
  // 문서는 있어도 매출·앱결제 집계가 전혀 없으면(수집 제외 브랜드의 빈 문서, CMS 집계가 빈 달 등) 리포트를 만들지
  // 않습니다. 빈 값으로 만들면 "-100%" 같은 잘못된 숫자가 담긴 빈 리포트가 발행됩니다(2026-11-11 처갓집 사례).
  const curSnapshot = snapshotFromData(yearMonth, cur.data ?? {});
  if (curSnapshot.totalPay == null && curSnapshot.appPay == null) {
    throw new ReportDataMissingError(
      `${yearMonth} 수집 데이터에 매출·앱결제 집계가 없어 리포트를 만들 수 없습니다. 수집 제외 브랜드이거나 CMS 집계가 비어 있는 달입니다. 다시 수집해도 비어 있으면 CMS 쪽을 확인해주세요.`
    );
  }

  const priorYms = Array.from({ length: HISTORY_MONTHS }, (_, i) => monthsBefore(yearMonth, HISTORY_MONTHS - i));
  const priorRefs = priorYms.map((ym) => db.collection("brandMonthlyData").doc(`${brandId}_${ym}`));
  const priorSnaps = await db.getAll(...priorRefs);
  const history = priorSnaps
    .map((s, i) => (s.exists ? snapshotFromData(priorYms[i], (s.data() as BrandMonthlyData).data ?? {}) : null))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // 전월 리포트에서 담당자가 적은 "익월 액션" — 이번 달 이행 점검 대상
  const prevDoc = priorSnaps[priorSnaps.length - 1];
  const prevOverrides = (prevDoc?.exists ? (prevDoc.data() as BrandMonthlyData).overrides : null) as ReportOverrides | null;
  const prevActions: ActionItem[] = Array.isArray(prevOverrides?.actions) ? (prevOverrides!.actions as ActionItem[]) : [];

  // 전월 일별 앱 매출(일평균·일별 추이 비교용)
  const prevData = prevDoc?.exists ? ((prevDoc.data() as BrandMonthlyData).data as Record<string, unknown> | undefined) : undefined;
  const prevList = (prevData?.dashboard as { recentSalesList?: unknown } | undefined)?.recentSalesList;
  const prevYmStr = monthsBefore(yearMonth, 1);
  const prevDaily = Array.isArray(prevList)
    ? (prevList as Record<string, unknown>[])
        .filter((r) => String(r.yyyymmdd ?? "").startsWith(prevYmStr) && (r.storeId === undefined || r.storeId === 0))
        .map((r) => ({ date: String(r.yyyymmdd), amount: Number(r.totalSalesAmt) || 0, orders: Number(r.orderCnt) || 0 }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];

  // 회원 구매 집계는 최근 3개월(당월 포함)만 읽습니다 — 없는 달은 건너뜁니다.
  const memberMonths: MonthMembers[] = [];
  for (const ym of [monthsBefore(yearMonth, 2), monthsBefore(yearMonth, 1), yearMonth]) {
    try {
      const agg = await loadMemberAggregates(db, brandId, ym);
      if (agg && agg.members.size > 0) memberMonths.push({ yearMonth: ym, map: agg.members, truncated: agg.truncated });
    } catch (e) {
      console.warn(`[loadReportInput] ${ym} 회원 집계 읽기 실패:`, e instanceof Error ? e.message : e);
    }
  }
  // 당월 집계가 없으면 이전 달만으로 "당월" 지표를 만들 수 없으므로 null 처리
  const members =
    memberMonths.length > 0 && memberMonths[memberMonths.length - 1].yearMonth === yearMonth
      ? computeMemberMetrics(memberMonths)
      : null;

  // 매장·메뉴 전체 목록(압축본) — 당월·전월·전전월. 없는 달은 null(해당 분석만 생략).
  const [bdCur, bdPrev, bdPrev2] = await Promise.all(
    [yearMonth, monthsBefore(yearMonth, 1), monthsBefore(yearMonth, 2)].map((ym) =>
      loadBreakdown(db, brandId, ym).catch((e) => {
        console.warn(`[loadReportInput] ${ym} 매장·메뉴 목록 읽기 실패:`, e instanceof Error ? e.message : e);
        return null;
      })
    )
  );

  return {
    brandName: brand.brand_name,
    companyName: brand.company_name,
    yearMonth,
    feeDefaults: brand.fee_defaults ?? null,
    current: (cur.data ?? {}) as Record<string, unknown>,
    history,
    members,
    overrides: (cur.overrides ?? {}) as ReportOverrides,
    prevActions,
    prevDaily,
    breakdowns: { cur: bdCur, prev: bdPrev, prev2: bdPrev2 },
    generatedAt: Date.now(),
  };
}
