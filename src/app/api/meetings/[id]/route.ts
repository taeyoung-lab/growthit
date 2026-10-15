import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";

// 2026-10-15: 회의록 전체 삭제(완전 삭제). 편집자(AUTHOR) 또는 SUPER_ADMIN만 가능합니다
// (firestore.rules의 meetings delete 규칙과 동일한 기준; 관리자(ADMIN)는 열람 전용이라 불가).
//
// 클라이언트에서 회의 문서 하나만 지우면 하위 데이터(permissions/participants/shares, 과제, 질의·답변,
// 결정사항·이력, 회의 간 연결, 회의 요약)가 고아 문서로 남기 때문에 서버(Admin SDK)에서 한 번에 지웁니다.
// 공유 접속 로그(meetingShareAccessLogs)는 감사 기록이라 남겨 둡니다.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { uid, profile } = await requireUser(_req);
    const meetingId = params.id;
    const db = getAdminDb();

    const meetingRef = db.collection("meetings").doc(meetingId);
    const meetingSnap = await meetingRef.get();
    if (!meetingSnap.exists) return NextResponse.json({ error: "회의록을 찾을 수 없습니다." }, { status: 404 });
    if (meetingSnap.data()?.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    if (profile.org_role !== "SUPER_ADMIN") {
      const permSnap = await meetingRef.collection("permissions").doc(uid).get();
      if (!permSnap.exists || permSnap.data()?.role !== "AUTHOR") {
        return NextResponse.json({ error: "회의록은 편집자 또는 슈퍼 관리자만 삭제할 수 있습니다." }, { status: 403 });
      }
    }

    // 하위 컬렉션을 가진 문서(질의→answers, 결정사항→history)는 recursiveDelete로 함께 지웁니다.
    const [actionItems, questions, decisions, relationsAsChild, relationsAsParent] = await Promise.all([
      db.collection("actionItems").where("meeting_id", "==", meetingId).get(),
      db.collection("questions").where("meeting_id", "==", meetingId).get(),
      db.collection("decisions").where("meeting_id", "==", meetingId).get(),
      db.collection("meetingRelations").where("child_meeting_id", "==", meetingId).get(),
      db.collection("meetingRelations").where("parent_meeting_id", "==", meetingId).get(),
    ]);

    for (const snap of [actionItems, questions, decisions, relationsAsChild, relationsAsParent]) {
      for (const d of snap.docs) await db.recursiveDelete(d.ref);
    }

    await db.collection("meetingSummaries").doc(meetingId).delete();
    await db.recursiveDelete(meetingRef); // permissions / participants / shares 포함

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "회의록 삭제에 실패했습니다." }, { status: 500 });
  }
}
