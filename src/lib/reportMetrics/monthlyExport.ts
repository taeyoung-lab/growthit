
// 월별 실적 CSV 내보내기용 행 만들기 — 프로젝션(매출 예측) 학습 데이터를 한 번에 내려받기 위한 순수 함수입니다.
// 리포트 화면과 같은 계산식(snapshotFromData → computeSalesBasis)을 그대로 쓰므로 화면 값과 일치합니다.
// 개인정보는 포함하지 않습니다(브랜드 단위 집계 숫자만).

import { snapshotFromData } from "./snapshot";
import { arr, num, numOrNull, rec, str } from "./util";

export const EXPORT_COLUMNS = [
  "브랜드",
  "브랜드ID",
  "서비스오픈일",
  "연월",
  "오픈후개월차", // 서비스 오픈월 = 1
  "전체매출",
  "온라인매출",
  "오프라인매출",
  "앱결제액",
  "앱주문수",
  "앱비중(%)",
  "앱_배달결제액",
  "앱_픽업결제액",
  "앱_매장결제액",
  "앱매출발생매장수",
  "집계대상매장수", // 매출통계에 잡힌 전체 매장 수(수집 시점 기준)
  "매장마스터_전체",
  "매장마스터_정상",
  "매장마스터_개점전",
  "미도입매장수", // 노출여부=미노출 AND 매장상태=개점전
  "목록_매출발생매장수", // brandMonthlyBreakdown(월별 매장 전체 목록)이 있는 달만
  "목록_앱결제발생매장수",
  "정산_결제금액", // CMS 정산(앱 결제) 합계 — 정산 조회가 실패한 달은 비어 있음
  "정산_PG수수료",
  "정산_서비스이용료", // 그로스잇이 받는 이용료의 실측값(수수료율 추정 검증용)
  "정산_예상정산금",
  "회원수",
  "신규회원수",
  "수집경로", // brandMonthlyData.source (MANUAL=발행 화면, BACKFILL=백필 등)
  "정산경로",
  "수집일시",
  "상세데이터유무", // 앱/전체 구분 데이터(extras) 유무 — N이면 전체매출·앱비중이 비어 있음
] as const;

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string | number | null>;

export interface ExportBrandInfo {
  id: string;
  brand_name: string;
  service_open_date: string | null;
}

export interface BreakdownCounts {
  stores: number;
  appStores: number;
}

/** 서비스 오픈월을 1로 센 개월차. 오픈일이 없거나 형식이 다르면 null. */
export function monthsSinceOpen(openDate: string | null, yearMonth: string): number | null {
  if (!openDate || !/^\d{4}-\d{2}/.test(openDate) || !/^\d{4}-\d{2}$/.test(yearMonth)) return null;
  const [oy, om] = openDate.slice(0, 7).split("-").map(Number);
  const [y, m] = yearMonth.split("-").map(Number);
  return (y - oy) * 12 + (m - om) + 1;
}

export function breakdownCounts(stores: unknown): BreakdownCounts | null {
  const s = rec(stores);
  const tp = arr(s.tp);
  const ap = arr(s.ap);
  if (tp.length === 0 && ap.length === 0) return null;
  return {
    stores: tp.filter((v) => num(v) > 0).length,
    appStores: ap.filter((v) => num(v) > 0).length,
  };
}

export function buildExportRow(
  brand: ExportBrandInfo,
  yearMonth: string,
  doc: { source?: unknown; collected_at?: unknown; data?: unknown },
  bd: BreakdownCounts | null
): ExportRow {
  const data = rec(doc.data);
  const snap = snapshotFromData(yearMonth, data);
  const extras = rec(data.extras);
  const meta = rec(extras.salesStoreMeta);
  const settle = rec(rec(data.settlementsSales).totalInfo);
  const storeList = arr(rec(data.storeManage).list).map(rec);
  const hasMaster = storeList.length > 0;
  const collectedAt = numOrNull(doc.collected_at);

  return {
    브랜드: brand.brand_name,
    브랜드ID: brand.id,
    서비스오픈일: brand.service_open_date,
    연월: yearMonth,
    오픈후개월차: monthsSinceOpen(brand.service_open_date, yearMonth),
    전체매출: snap.totalPay,
    온라인매출: snap.onlinePay,
    오프라인매출: snap.offlinePay,
    앱결제액: snap.appPay,
    앱주문수: snap.appOrders,
    "앱비중(%)": snap.appShare,
    앱_배달결제액: snap.appDeliveryPay,
    앱_픽업결제액: snap.appPickupPay,
    앱_매장결제액: snap.appStorePay,
    앱매출발생매장수: numOrNull(meta.withAppStores),
    집계대상매장수: numOrNull(meta.totalStores),
    매장마스터_전체: hasMaster ? Math.max(num(rec(data.storeManage).totalCnt), storeList.length) : null,
    매장마스터_정상: hasMaster ? storeList.filter((s) => str(s.storeSt) === "350001").length : null,
    매장마스터_개점전: hasMaster ? storeList.filter((s) => str(s.storeSt) === "350004").length : null,
    미도입매장수: hasMaster
      ? storeList.filter((s) => num(s.displayYn) === 0 && str(s.storeSt) === "350004").length
      : null,
    목록_매출발생매장수: bd ? bd.stores : null,
    목록_앱결제발생매장수: bd ? bd.appStores : null,
    정산_결제금액: numOrNull(settle.itemPayAmount),
    정산_PG수수료: numOrNull(settle.pgFee),
    정산_서비스이용료: numOrNull(settle.serviceFee),
    정산_예상정산금: numOrNull(settle.totalFee),
    회원수: snap.members,
    신규회원수: snap.newMembers,
    수집경로: str(doc.source) || null,
    정산경로: str(data.settlementSource) || null,
    수집일시: collectedAt ? new Date(collectedAt + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) : null,
    상세데이터유무: snap.hasExtras ? "Y" : "N",
  };
}

function csvCell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel이 한글을 깨뜨리지 않도록 UTF-8 BOM을 붙인 CSV 문자열. */
export function rowsToCsv(rows: ExportRow[]): string {
  const head = EXPORT_COLUMNS.join(",");
  const body = rows.map((r) => EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(",")).join("\n");
  return "﻿" + head + "\n" + body + "\n";
}
