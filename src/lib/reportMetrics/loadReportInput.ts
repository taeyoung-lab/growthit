// 서버 전용: Firestore에 저장된 월 데이터·회원 집계·담당자 입력을 모아 ReportInput을 만듭니다.
// 화면④ 미리보기(GET)와 PPT 발행(POST)이 같은 입력을 쓰도록 한곳에 둡니다.

import type { Firestore } from "firebase-admin/firestore";
import { loadMemberAggregates } from "@/lib/cmsAutomation/memberAggStore";
import type { BrandMonthlyData, ReportBrand } from "@/lib/types";
import { computeMemberMetrics, type MonthMembers } from "./memberMetrics";
import { snapshotFromData } from "./snapshot";
import type { ActionItem, ReportInput, ReportOverrides } from "./types";
import { monthsBefore } from "./util";

export class ReportDataMissingError extends Error {}

const HISTORY_MONTHS = 5;

export async function loadReportInput(db: Firestore, brand: ReportBrand, yearMonth: string): Promise<ReportInput> {
  const brandId = brand.id;
  const curSnap = await db.collection("brandMonthlyData").doc(`${brandId}_${yearMonth}`).get();
  if (!curSnap.exists) {
    throw new ReportDataMissingError(`${yearMonth} 데이터가 아직 수집되지 않았습니다. 먼저 데이터를 수집해주세요.`);
  }
  const cur = curSnap.data() as BrandMonthlyData;

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
    generatedAt: Date.now(),
  };
}
