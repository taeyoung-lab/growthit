import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSuperAdmin, ApiAuthError } from "@/lib/adminAuthCheck";

// 5장: 회사 생성/수정. 다른 회사(파트너사) 사용자를 정확히 표시·공유하려면
// SUPER_ADMIN이 파트너사 Organization도 등록할 수 있어야 하므로 org 소속 제한은 두지 않습니다.
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { organization_name, organization_code } = body;
    if (!organization_name || !organization_code) {
      return NextResponse.json({ error: "회사명과 회사코드는 필수입니다." }, { status: 400 });
    }

    const now = Date.now();
    const ref = getAdminDb().collection("organizations").doc();
    await ref.set({
      id: ref.id,
      organization_name,
      organization_code,
      organization_status: "ACTIVE",
      created_at: now,
      updated_at: now,
    });

    return NextResponse.json({ id: ref.id });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "회사 생성에 실패했습니다." }, { status: 500 });
  }
}
