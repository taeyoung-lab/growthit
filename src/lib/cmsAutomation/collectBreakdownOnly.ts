
import { getAdminDb } from "@/lib/firebase/admin";
import { decryptCmsPassword } from "@/lib/cmsCredentials";
import { loginToCms } from "@/lib/cmsAutomation/login";
import { getJson } from "@/lib/cmsAutomation/collect";
import { collectExtras } from "@/lib/cmsAutomation/collectExtras";
import { saveBreakdown } from "@/lib/cmsAutomation/breakdownStore";
import { saveMemberAggregates } from "@/lib/cmsAutomation/memberAggStore";
import type { BrandCredentials, ReportBrand } from "@/lib/types";

// 정산(settlements)을 건드리지 않고 "월별 매장·메뉴 전체 목록"(brandMonthlyBreakdown)과 회원 집계만 다시 수집합니다.
// 2026-10-07: 우지커피처럼 매장이 많은 브랜드는 CMS 정산 조회가 504로 끊겨 전체 재수집이 실패하는데, 기존/신규 매장 분해·
// 메뉴 변화에는 정산이 필요 없으므로 이 경로로 따로 채웁니다. brandMonthlyData(본 데이터·overrides·published)는
// 읽지도 쓰지도 않아 기존 수집분이 그대로 보존됩니다.
const pad = (n: number) => String(n).padStart(2, "0");
function monthRange(yearMonth: string): { startDt: string; endDt: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { startDt: `${y}-${pad(m)}-01`, endDt: `${y}-${pad(m)}-${pad(last)}` };
}

export async function collectBreakdownOnly(opts: {
  brandId: string;
  brand: ReportBrand;
  creds: BrandCredentials;
  yearMonth: string;
}): Promise<{ stores: number; items: number; members: number; itemFields: unknown }> {
  const { brandId, brand, creds, yearMonth } = opts;
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
  const { startDt, endDt } = monthRange(yearMonth);
  const res = await collectExtras(getJson, brand.cms_url, session.cookieHeader, yearMonth, startDt, endDt);
  if (!res.breakdown) throw new Error("매장·메뉴 목록을 수집하지 못했습니다(이 브랜드 CMS는 해당 통계를 지원하지 않을 수 있습니다).");
  await saveBreakdown(db, { brandId, organizationId: brand.organization_id, yearMonth, breakdown: res.breakdown });
  if (res.memberOrderAgg) {
    try {
      await saveMemberAggregates(db, { brandId, organizationId: brand.organization_id, yearMonth, agg: res.memberOrderAgg });
    } catch (e) {
      console.warn(`[collectBreakdownOnly ${brandId}] 회원 집계 저장 실패`, e);
    }
  }
  const b = res.breakdown;
  return {
    stores: b.stores.id.length,
    items: b.items.key.length,
    members: res.memberOrderAgg ? res.memberOrderAgg.flat.length / 3 : 0,
    itemFields: b.fields,
  };
}
