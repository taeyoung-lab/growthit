import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";

// 최초 로그인 시 비밀번호를 재설정한 뒤 호출 — must_change_password 플래그를 내립니다.
// (users/{uid} 문서는 firestore.rules에서 클라이언트 직접 쓰기를 막아뒀으므로 서버 라우트로 처리)
export async function POST(req: NextRequest) {
  try {
    const { uid } = await requireUser(req);
    await getAdminDb().collection("users").doc(uid).update({
      must_change_password: false,
      updated_at: Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "처리에 실패했습니다." }, { status: 500 });
  }
}
