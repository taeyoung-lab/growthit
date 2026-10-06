
// 저장된 월 데이터(brandMonthlyData.data) 1건 → 비교용 작은 스냅샷.
// 앱/전체 구분 데이터(extras)가 생기기 전에 백필된 달은 정산 데이터의 합계(itemPayAmount·orderCount =
// 앱 결제액·앱 주문 수와 일치함을 영커피 2026-09로 확인)로 앱결제액만 추정합니다.

import type { CmsExtras } from "@/lib/cmsAutomation/collectExtras";
import { computeSalesBasis } from "./salesBasis";
import type { MonthSnapshot } from "./types";
import { numOrNull, rec } from "./util";

export function snapshotFromData(yearMonth: string, data: Record<string, unknown>): MonthSnapshot {
  const extras = (data.extras ?? null) as CmsExtras | null;
  const basis = computeSalesBasis(extras);
  const dash = rec(data.dashboard);
  const totalInfo = rec(rec(data.settlementsSales).totalInfo);
  const members = numOrNull(rec(dash.totalMemberCnt).cnt);
  const newMembers = numOrNull(rec(dash.totalNewMemberCnt).cnt);

  if (basis) {
    const row = extras?.salesStore?.find((r) => r.name === "전체") ?? extras?.salesStore?.[0];
    return {
      yearMonth,
      hasExtras: true,
      totalPay: basis.totalPay,
      onlinePay: basis.onlinePay,
      offlinePay: basis.offlinePay,
      appPay: basis.appPay,
      appOrders: basis.appOrders,
      appShare: basis.appShare,
      appDeliveryPay: row?.app?.delivery.pay ?? null,
      appPickupPay: row?.app?.pickup.pay ?? null,
      appStorePay: row?.app?.store.pay ?? null,
      members,
      newMembers,
    };
  }
  return {
    yearMonth,
    hasExtras: false,
    totalPay: null,
    onlinePay: null,
    offlinePay: null,
    appPay: numOrNull(totalInfo.itemPayAmount),
    appOrders: numOrNull(totalInfo.orderCount),
    appShare: null,
    appDeliveryPay: null,
    appPickupPay: null,
    appStorePay: null,
    members,
    newMembers,
  };
}
