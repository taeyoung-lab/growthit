import { getAdminDb } from "@/lib/firebase/admin";
import { decryptCmsPassword } from "@/lib/cmsCredentials";
import { loginToCms } from "@/lib/cmsAutomation/login";
import { collectMonthlyData } from "@/lib/cmsAutomation/collect";
import { saveMemberAggregates, fitMonthlyDataSize } from "@/lib/cmsAutomation/memberAggStore";
import type { BrandCredentials, BrandMonthlyData, BrandMonthlyDataSource, ReportBrand } from "@/lib/types";

// 한 브랜드의 한 달치 데이터를 CMS에서 수집해 brandMonthlyData에 저장하는 공통 로직(로그인 → 수집 → 저장 →
// 회원 구매 집계 저장). 2026-10-07: 수동 수집 라우트(/api/brands/{id}/collect)에 있던 것을 그대로 옮겨,
// 자동 월간 수집(/api/cron/collect-monthly)과 같이 쓰도록 분리했습니다. 동작은 기존 수동 수집과 동일합니다.
// 실패하면 CmsAutomationError 등을 그대로 던지니 호출하는 쪽에서 처리하세요.
export async function collectAndStoreMonth(opts: {
  brandId: string;
  brand: ReportBrand;
  creds: BrandCredentials;
  yearMonth: string; // YYYY-MM
  collectedBy: string | null; // 사용자 uid, 자동 수집이면 null
  source: BrandMonthlyDataSource;
}): Promise<BrandMonthlyData> {
  const { brandId, brand, creds, yearMonth, collectedBy, source } = opts;
  const db = getAdminDb();

  const session = await loginToCms({
    cmsUrl: brand.cms_url,
    username: creds.cms_username,
    password: decryptCmsPassword(creds.cms_password_encrypted),
    phoneVerificationRequired: brand.phone_verification_required,
    fixedVerificationCode: creds.fixed_verification_code_encrypted
      ? decryptCmsPassword(creds.fixed_verification_code_encrypted)
      : null,
  });
  const collected = await collectMonthlyData(brand.cms_url, session, yearMonth);

  const now = Date.now();
  const docId = `${brandId}_${yearMonth}`;
  const existing = await db.collection("brandMonthlyData").doc(docId).get();

  const data: BrandMonthlyData = {
    id: docId,
    organization_id: brand.organization_id,
    brand_id: brandId,
    year_month: yearMonth,
    source,
    data: fitMonthlyDataSize({
      dashboard: collected.dashboard,
      settlementsSales: collected.settlementsSales,
      settlementSource: collected.settlementSource,
      targetGroupStats: collected.targetGroupStats,
      storeManage: collected.storeManage,
      memberStats: collected.memberStats,
      extras: collected.extras,
    }),
    // 기존에 담당자가 화면④에서 직접 고친 값(overrides)이 있다면 재수집 시에도 보존합니다 —
    // 원본(data)만 최신 수집값으로 갈아끼우고, 사람이 직접 고친 값은 자동 덮어쓰기 대상이 아닙니다.
    overrides: (existing.exists && (existing.data() as BrandMonthlyData).overrides) || {},
    published: (existing.exists && (existing.data() as BrandMonthlyData).published) || false,
    collected_at: collected.collectedAt,
    collected_by: collectedBy,
    updated_at: now,
  };
  await db.collection("brandMonthlyData").doc(docId).set(data);

  // 회원별 월간 구매 집계는 용량 때문에 별도 컬렉션에 저장합니다. 실패해도 위 본 데이터는 이미 저장됐으므로
  // 수집 전체를 실패로 돌리지 않고 경고만 남깁니다(회원 지표만 비게 됨).
  if (collected.memberOrderAgg) {
    try {
      await saveMemberAggregates(db, {
        brandId,
        organizationId: brand.organization_id,
        yearMonth,
        agg: collected.memberOrderAgg,
      });
    } catch (e) {
      console.warn(`[collectAndStoreMonth ${brandId}] 회원 집계 저장 실패`, e);
    }
  }
  return data;
}

