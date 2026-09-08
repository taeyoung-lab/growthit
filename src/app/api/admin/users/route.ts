import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireSuperAdmin, ApiAuthError } from "@/lib/adminAuthCheck";
import type { OrgRole } from "@/lib/types";

const VALID_ROLES: OrgRole[] = ["SUPER_ADMIN", "ADMIN", "USER"];
const INITIAL_PASSWORD = "1234"; // 5장: 초기 비밀번호는 고정값 1234, 최초 로그인 시 변경 필수

// 5장 회원관리: 사용자 생성은 슈퍼 관리자가 이메일로 계정을 발급하는 방식입니다(자체 가입 없음).
// Firebase Auth 계정 생성 + Firestore users/{uid} 프로필 생성을 함께 수행합니다.
export async function POST(req: NextRequest) {
  try {
    const { profile: adminProfile } = await requireSuperAdmin(req);
    const body = await req.json();
    const { user_name, email, phone, department_id, org_role, organization_id } = body;

    const targetOrgId = organization_id || adminProfile.organization_id;
    if (targetOrgId !== adminProfile.organization_id) {
      return NextResponse.json({ error: "다른 회사의 사용자는 생성할 수 없습니다." }, { status: 403 });
    }
    if (!user_name || !email) {
      return NextResponse.json({ error: "이름과 이메일은 필수입니다." }, { status: 400 });
    }
    const role: OrgRole = VALID_ROLES.includes(org_role) ? org_role : "USER";

    const userRecord = await getAdminAuth().createUser({
      email,
      password: INITIAL_PASSWORD,
      displayName: user_name,
    });

    const now = Date.now();
    await getAdminDb()
      .collection("users")
      .doc(userRecord.uid)
      .set({
        id: userRecord.uid,
        organization_id: targetOrgId,
        department_id: department_id || null,
        user_name,
        email,
        phone: phone || null,
        org_role: role,
        user_status: "ACTIVE",
        must_change_password: true,
        last_dashboard_visit_at: null,
        created_at: now,
        updated_at: now,
      });

    return NextResponse.json({ uid: userRecord.uid, initial_password: INITIAL_PASSWORD });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "사용자 생성에 실패했습니다." }, { status: 500 });
  }
}

// 수정: 이름/부서/권한/상태 변경, 그리고 reset_password:true 로 비밀번호 리셋
export async function PATCH(req: NextRequest) {
  try {
    const { profile: adminProfile } = await requireSuperAdmin(req);
    const body = await req.json();
    const { uid, reset_password, ...updates } = body;
    if (!uid) return NextResponse.json({ error: "uid가 필요합니다." }, { status: 400 });

    const targetSnap = await getAdminDb().collection("users").doc(uid).get();
    if (!targetSnap.exists || targetSnap.data()?.organization_id !== adminProfile.organization_id) {
      return NextResponse.json({ error: "대상 사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    // 비밀번호 리셋 버튼: Auth 비밀번호를 1234로 되돌리고, 다음 로그인 시 재설정을 다시 강제합니다.
    if (reset_password) {
      await getAdminAuth().updateUser(uid, { password: INITIAL_PASSWORD });
      await getAdminDb().collection("users").doc(uid).update({
        must_change_password: true,
        updated_at: Date.now(),
      });
      return NextResponse.json({ ok: true, initial_password: INITIAL_PASSWORD });
    }

    const allowed = ["user_name", "phone", "department_id", "org_role", "user_status"];
    const safeUpdates: Record<string, unknown> = { updated_at: Date.now() };
    for (const key of allowed) {
      if (key in updates) {
        if (key === "org_role" && !VALID_ROLES.includes(updates.org_role)) continue;
        safeUpdates[key] = updates[key];
      }
    }

    await getAdminDb().collection("users").doc(uid).update(safeUpdates);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "사용자 수정에 실패했습니다." }, { status: 500 });
  }
}

// 삭제 = soft-delete: 계정은 비활성화(로그인 차단)하되, 회의/문답 등 기존 데이터는 그대로 보존합니다.
export async function DELETE(req: NextRequest) {
  try {
    const { profile: adminProfile } = await requireSuperAdmin(req);
    const { searchParams } = new URL(req.url);
    const uid = searchParams.get("uid");
    if (!uid) return NextResponse.json({ error: "uid가 필요합니다." }, { status: 400 });
    if (uid === adminProfile.id) {
      return NextResponse.json({ error: "본인 계정은 삭제할 수 없습니다." }, { status: 400 });
    }

    const targetSnap = await getAdminDb().collection("users").doc(uid).get();
    if (!targetSnap.exists || targetSnap.data()?.organization_id !== adminProfile.organization_id) {
      return NextResponse.json({ error: "대상 사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    // Firebase Auth 계정을 비활성화해 로그인을 차단합니다 (계정 자체나 관련 데이터는 삭제하지 않음).
    await getAdminAuth().updateUser(uid, { disabled: true });
    await getAdminDb().collection("users").doc(uid).update({
      user_status: "INACTIVE",
      updated_at: Date.now(),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "사용자 삭제에 실패했습니다." }, { status: 500 });
  }
}
