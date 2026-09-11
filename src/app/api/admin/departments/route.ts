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

// 수정: 부서명/부서코드/상위부서 변경. 생성과 동일하게 자기 회사 부서만 관리합니다.
export async function PATCH(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const body = await req.json();
    const { id, department_name, department_code, parent_department_id } = body;
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const ref = getAdminDb().collection("departments").doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: "대상 부서를 찾을 수 없습니다." }, { status: 404 });
    }
    if (parent_department_id === id) {
      return NextResponse.json({ error: "상위 부서를 자기 자신으로 지정할 수 없습니다." }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: Date.now() };
    if (department_name) updates.department_name = department_name;
    if (department_code) updates.department_code = department_code;
    if ("parent_department_id" in body) updates.parent_department_id = parent_department_id || null;

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "부서 수정에 실패했습니다." }, { status: 500 });
  }
}

// 삭제 = soft-delete: 이 부서 소속 사용자·회의 데이터는 department_id/기록으로 참조하고 있으므로
// 문서를 실제로 지우지 않고 department_status만 INACTIVE로 바꿉니다(사용자 삭제와 동일한 원칙).
// 이 부서를 상위 부서로 두고 있던 하위 부서는 자동으로 최상위(상위 부서 없음)로 승격됩니다.
export async function DELETE(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    const db = getAdminDb();
    const ref = db.collection("departments").doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: "대상 부서를 찾을 수 없습니다." }, { status: 404 });
    }

    const childrenSnap = await db
      .collection("departments")
      .where("organization_id", "==", profile.organization_id)
      .where("parent_department_id", "==", id)
      .get();

    const batch = db.batch();
    batch.update(ref, { department_status: "INACTIVE", updated_at: Date.now() });
    childrenSnap.docs.forEach((child) => {
      batch.update(child.ref, { parent_department_id: null, updated_at: Date.now() });
    });
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "부서 비활성화에 실패했습니다." }, { status: 500 });
  }
}
