import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSuperAdmin, ApiAuthError } from "@/lib/adminAuthCheck";
import { syncUserClaims } from "@/lib/firebase/userClaims";
import type { OrgRole, UserProfile } from "@/lib/types";

// 2026-09-16: 기존에 이미 만들어져 있던 계정들은 로그인 토큰에 org_role/organization_id
// 클레임이 없습니다(클레임은 새로 만들거나 권한을 바꿀 때만 채워집니다). Firestore 보안 규칙을
// 회의/질의/향후추진과제 LIST 쿼리에서 이 클레임 기준으로 admin 여부를 판단하도록 바꿨으므로,
// 기존 계정들도 한 번은 이 API로 클레임을 채워줘야 합니다(관리자 화면의 "권한 동기화" 버튼).
// 이후 각 사용자는 다음 로그인(또는 페이지 새로고침 후 자동 토큰 갱신) 시점부터 반영됩니다.
export async function POST(req: NextRequest) {
  try {
    const { profile: adminProfile } = await requireSuperAdmin(req);

    const snap = await getAdminDb()
      .collection("users")
      .where("organization_id", "==", adminProfile.organization_id)
      .get();

    let synced = 0;
    for (const docSnap of snap.docs) {
      const u = docSnap.data() as UserProfile;
      await syncUserClaims(docSnap.id, { org_role: u.org_role as OrgRole, organization_id: u.organization_id });
      synced += 1;
    }

    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "권한 클레임 동기화에 실패했습니다." }, { status: 500 });
  }
}

