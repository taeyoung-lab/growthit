// 리포트 매출 기준 정의 — 담당자(박태영, 2026-10-06) 확정. CMS 화면 값이 서로 다를 때는 이 정의가 우선입니다.
//
//   전체 매출액  = 매출통계 "전체" 조회의 전체 실결제액(배달비 제외) = 온라인 + 오프라인
//   앱결제액     = 그로스잇 매출액 = "우리가잇다"(963001) 채널 실결제액
//   앱 비중      = 앱결제액 ÷ 전체 매출액   (영커피 2026-09: 81,989,980 ÷ 1,435,486,629 = 5.71%)
//   온라인/오프라인 = "전체" 조회의 salesTp 962001/962002 값(영커피 2026-09: 451,969,656 / 983,516,973)
//
// 영커피 CMS에서 "온라인" 필터 화면의 합계(380,322,676)가 "전체" 화면의 온라인(451,969,656)과 달랐는데,
// 담당자가 CMS 쪽 오류로 판단해 CMS를 고치기로 했습니다 — 그래서 분모·온라인·오프라인은 항상 "전체"
// 조회 값을 쓰고, 채널 필터 조회(앱·배달앱별)는 앱결제액과 채널 간 비교에만 씁니다.

import type { CmsExtras } from "@/lib/cmsAutomation/collectExtras";

export interface SalesBasis {
  totalPay: number; // 전체 매출액(온라인+오프라인)
  onlinePay: number;
  offlinePay: number;
  appPay: number; // 그로스잇 매출액(앱결제액)
  appOrders: number;
  appShare: number | null; // 0~100, 소수 둘째 자리 반올림. 전체 매출이 0이면 null
}

export function computeSalesBasis(extras: CmsExtras | null | undefined): SalesBasis | null {
  const total = extras?.salesStore?.find((r) => r.name === "전체") ?? extras?.salesStore?.[0];
  if (!total) return null;
  const totalPay = total.all.total.pay;
  const appPay = total.app?.total.pay ?? 0;
  return {
    totalPay,
    onlinePay: total.online?.total.pay ?? 0,
    offlinePay: total.offline?.total.pay ?? 0,
    appPay,
    appOrders: total.app?.total.ord ?? 0,
    appShare: totalPay > 0 ? Math.round((appPay / totalPay) * 10000) / 100 : null,
  };
}

