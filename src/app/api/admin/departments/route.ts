import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSuperAdmin, ApiAuthError } from "@/lib/adminAuthCheck";

export async function POST(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const body = await req.json();
    const { department_name, department_code, parent_department_id, organization_id } = body;

    // 자기 회사 부서만 관리 (다른 회사 부서 구조에는 관여하지 않음)
    const targetOrgId = organization_id || profile.organization_id;
    if (targetOrgId !== profile.organization_id) {
      return NextResponse.json({ error: "다른 회사의 부서는 생성할 수 없습니다." }, { status: 403 });
    }
    if (!department_name || !department_code) {
      return NextResponse.json({ error: "부서명과 부서코드는 필수입니다." }, { status: 400 });
    }

    const now = Date.now();
    const ref = getAdminDb().collection("departments").doc();
    await ref.set({
      id: ref.id,
      organization_id: targetOrgId,
      parent_department_id: parent_department_id || null,
      department_name,
      department_code,
      department_status: "ACTIVE",
      created_at: now,
      updated_at: now,
    });

    return NextResponse.json({ id: ref.id });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "부서 생성에 실패했습니다." }, { status: 500 });
  }
}
