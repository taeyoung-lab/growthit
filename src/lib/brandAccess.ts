import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";
import type { ReportBrand, UserProfile } from "@/lib/types";

// 그로스잇 브랜드 데이터 접근 권한 — 2026-10-06 결정:
//   · 슈퍼 관리자(SUPER_ADMIN): 같은 조직의 모든 브랜드
//   · 담당자: 해당 브랜드의 manager_uids에 포함된 사용자(복수 가능, 생성자는 항상 포함)
//   · 그 외(관리자 ADMIN·일반 USER 포함): 접근 불가 — 목록에도 보이지 않습니다.
// manager_uids가 없는 기존 브랜드는 생성자 1명만 담당자로 간주합니다(마이그레이션 불필요).

/** 브랜드의 실제 담당자 uid 목록(생성자 항상 포함, 중복 제거). */
export function brandManagerUids(b: Pick<ReportBrand, "created_by" | "manager_uids">): string[] {
  return Array.from(new Set([b.created_by, ...(b.manager_uids ?? [])].filter(Boolean)));
}

export function canAccessBrand(
  profile: Pick<UserProfile, "org_role" | "organization_id">,
  uid: string,
  brand: Pick<ReportBrand, "organization_id" | "created_by" | "manager_uids">
): boolean {
  if (brand.organization_id !== profile.organization_id) return false;
  if (profile.org_role === "SUPER_ADMIN") return true;
  return brandManagerUids(brand).includes(uid);
}

/**
 * 로그인 사용자 확인 + 브랜드 로드 + 접근 권한 검사를 한 번에 합니다.
 * 존재하지 않는 브랜드는 404, 담당자가 아니거나 다른 조직이면 403입니다.
 */
export async function requireBrandAccess(
  req: NextRequest,
  brandId: string
): Promise<{ uid: string; profile: UserProfile; brand: ReportBrand }> {
  const { uid, profile } = await requireUser(req);
  const snap = await getAdminDb().collection("brands").doc(brandId).get();
  if (!snap.exists) throw new ApiAuthError("대상 브랜드를 찾을 수 없습니다.", 404);
  const brand = { ...(snap.data() as ReportBrand), id: snap.id };
  if (!canAccessBrand(profile, uid, brand)) {
    throw new ApiAuthError("이 브랜드에 접근할 권한이 없습니다. 브랜드 담당자 또는 슈퍼 관리자만 사용할 수 있습니다.", 403);
  }
  return { uid, profile, brand };
}

