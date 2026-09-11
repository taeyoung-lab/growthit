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

// 수정: 회사명/회사코드 변경. 생성과 동일하게 소속 제한 없이 슈퍼 관리자면 모든 회사를 수정할 수 있습니다
// (파트너사 Organization도 관리 화면에서 등록·정정할 수 있어야 하므로).
export async function PATCH(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { id, organization_name, organization_code } = body;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const ref = getAdminDb().collection("organizations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "대상 회사를 찾을 수 없습니다." }, { status: 404 });

    const updates: Record<string, unknown> = { updated_at: Date.now() };
    if (organization_name) updates.organization_name = organization_name;
    if (organization_code) updates.organization_code = organization_code;

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "회사 수정에 실패했습니다." }, { status: 500 });
  }
}

// 삭제 = soft-delete: 이 회사 소속 부서/사용자/프로젝트/회의 데이터는 organization_id로 참조하고
// 있으므로 문서를 실제로 지우지 않고 organization_status만 INACTIVE로 바꿉니다(사용자 삭제와 동일한 원칙).
// 관리 화면 목록에서는 비활성으로 표시되지만 기존 데이터 조회에는 영향이 없습니다.
export async function DELETE(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    if (id === profile.organization_id) {
      return NextResponse.json({ error: "본인이 속한 회사는 비활성화할 수 없습니다." }, { status: 400 });
    }

    const ref = getAdminDb().collection("organizations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "대상 회사를 찾을 수 없습니다." }, { status: 404 });

    await ref.update({ organization_status: "INACTIVE", updated_at: Date.now() });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "회사 비활성화에 실패했습니다." }, { status: 500 });
  }
}
