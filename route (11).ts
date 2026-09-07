import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireMeetingRole, ApiAuthError } from "@/lib/adminAuthCheck";
import { suggestQuestionLinks } from "@/lib/claude";
import type { TranscriptSegment } from "@/lib/types";

const OPEN_STATUSES = ["ANSWER_PENDING", "IN_PROGRESS", "NEEDS_CONFIRMATION", "NEXT_MEETING", "OVERDUE"];

// 19장: 새 회의 발언 ↔ 기존 미답변 질의 자동 연결 "제안". 자동 확정하지 않습니다.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const meetingId = params.id;
  try {
    await requireMeetingRole(req, meetingId, ["AUTHOR", "PARTICIPANT"]);

    const meetingSnap = await getAdminDb().collection("meetings").doc(meetingId).get();
    if (!meetingSnap.exists) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
    const meeting = meetingSnap.data()!;

    const openQuestionsSnap = await getAdminDb()
      .collection("questions")
      .where("project_id", "==", meeting.project_id)
      .where("question_status", "in", OPEN_STATUSES)
      .get();
    const openQuestions = openQuestionsSnap.docs
      .filter((d) => d.id !== meetingId)
      .map((d) => ({ id: d.id, question_content: d.data().question_content as string }));

    const segmentsSnap = await getAdminDb()
      .collection("transcripts")
      .doc(meetingId)
      .collection("segments")
      .orderBy("order", "asc")
      .get();
    const segments = segmentsSnap.docs.map((d) => d.data() as TranscriptSegment);

    const suggestions = await suggestQuestionLinks(openQuestions, segments);
    return NextResponse.json({ suggestions });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "연결 제안 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
