import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireOrgAdmin, ApiAuthError } from "@/lib/adminAuthCheck";
import { randomBytes } from "crypto";

// 5장 회원관리: 사용자 생성은 관리자가 이메일로 계정을 발급하는 방식입니다(자체 가입 없음).
// Firebase Auth 계정 생성 + Firestore users/{uid} 프로필 생성을 함께 수행합니다.
export async function POST(req: NextRequest) {
  try {
    const { profile: adminProfile } = await requireOrgAdmin(req);
    const body = await req.json();
    const { user_name, email, phone, department_id, org_role, organization_id } = body;

    const targetOrgId = organization_id || adminProfile.organization_id;
    if (targetOrgId !== adminProfile.organization_id) {
      return NextResponse.json({ error: "다른 회사의 사용자는 생성할 수 없습니다." }, { status: 403 });
    }
    if (!user_name || !email) {
      return NextResponse.json({ error: "이름과 이메일은 필수입니다." }, { status: 400 });
    }

    // 임시 초기 비밀번호를 발급하고, 실제로는 이메일로 안내 후 최초 로그인 시 변경을 권장합니다.
    // (이메일 발송 연동은 2차 범위 — README의 "다음 단계" 참고)
    const initialPassword = randomBytes(9).toString("base64url");

    const userRecord = await getAdminAuth().createUser({
      email,
      password: initialPassword,
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
        org_role: org_role === "ORG_ADMIN" ? "ORG_ADMIN" : "MEMBER",
        user_status: "ACTIVE",
        created_at: now,
        updated_at: now,
      });

    return NextResponse.json({ uid: userRecord.uid, initial_password: initialPassword });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "사용자 생성에 실패했습니다." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { profile: adminProfile } = await requireOrgAdmin(req);
    const body = await req.json();
    const { uid, ...updates } = body;
    if (!uid) return NextResponse.json({ error: "uid가 필요합니다." }, { status: 400 });

    const targetSnap = await getAdminDb().collection("users").doc(uid).get();
    if (!targetSnap.exists || targetSnap.data()?.organization_id !== adminProfile.organization_id) {
      return NextResponse.json({ error: "대상 사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    const allowed = ["user_name", "phone", "department_id", "org_role", "user_status"];
    const safeUpdates: Record<string, unknown> = { updated_at: Date.now() };
    for (const key of allowed) {
      if (key in updates) safeUpdates[key] = updates[key];
    }

    await getAdminDb().collection("users").doc(uid).update(safeUpdates);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "사용자 수정에 실패했습니다." }, { status: 500 });
  }
}
