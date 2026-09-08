import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";

// 알림 축소 기능: 개별 알림을 저장하지 않고, 대시보드 접속 시각만 기록합니다.
// 클라이언트는 이 값을 갱신하기 "전에" 먼저 읽어서 "지난 방문 이후 업데이트"를 계산합니다.
export async function POST(req: NextRequest) {
  try {
    const { uid, profile } = await requireUser(req);
    const previous = profile.last_dashboard_visit_at;
    await getAdminDb().collection("users").doc(uid).update({
      last_dashboard_visit_at: Date.now(),
      updated_at: Date.now(),
    });
    return NextResponse.json({ previous });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "처리에 실패했습니다." }, { status: 500 });
  }
}
