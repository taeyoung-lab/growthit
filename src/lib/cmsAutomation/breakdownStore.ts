import type { Firestore } from "firebase-admin/firestore";
import type { MonthBreakdown } from "./collectExtras";

// 월별 매장·메뉴 전체 목록(압축본)을 brandMonthlyBreakdown 컬렉션에 저장합니다(문서 ID: `${brandId}_${yearMonth}`).
// brandMonthlyData는 문서 1MB 제한 때문에 매장·메뉴를 상위 일부만 남기므로, 전월과 같은 매장·메뉴를 짝지어
// 비교해야 하는 "기존/신규 매장 증감 분해"·"메뉴 변화"용 데이터를 여기에 따로 둡니다. 이 컬렉션은
// firestore.rules에 규칙이 없어(기본 거부) 클라이언트 접근이 전면 차단되고, 서버(firebase-admin)에서만 읽고 씁니다.
// 개인정보는 없습니다(매장명·메뉴명·집계 숫자).
export const breakdownDocId = (brandId: string, yearMonth: string) => `${brandId}_${yearMonth}`;

export async function saveBreakdown(
  db: Firestore,
  params: { brandId: string; organizationId: string; yearMonth: string; breakdown: MonthBreakdown }
): Promise<void> {
  const { brandId, organizationId, yearMonth, breakdown } = params;
  await db.collection("brandMonthlyBreakdown").doc(breakdownDocId(brandId, yearMonth)).set({
    brand_id: brandId,
    organization_id: organizationId,
    year_month: yearMonth,
    stores: breakdown.stores,
    items: breakdown.items,
    fields: breakdown.fields,
    updated_at: Date.now(),
  });
}

export async function loadBreakdown(db: Firestore, brandId: string, yearMonth: string): Promise<MonthBreakdown | null> {
  const snap = await db.collection("brandMonthlyBreakdown").doc(breakdownDocId(brandId, yearMonth)).get();
  if (!snap.exists) return null;
  const d = snap.data() as Partial<MonthBreakdown>;
  if (!d.stores || !d.items) return null;
  return { stores: d.stores, items: d.items, fields: d.fields ?? null };
}

