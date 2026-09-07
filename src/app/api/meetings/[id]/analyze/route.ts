import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireMeetingRole, ApiAuthError } from "@/lib/adminAuthCheck";
import { analyzeMeetingTranscript } from "@/lib/claude";
import type { TranscriptSegment, UserProfile } from "@/lib/types";

// 7장 파이프라인의 "AI 분석 → 구조화" 단계.
// 요약은 서버가 바로 저장하지만(수정 리스크가 낮음), 질의·결정·액션아이템은
// 담당자 매칭 정확도 문제(검토 리포트 "화자 인식" 리스크와 동일한 이유로 이름 매칭도 완벽하지 않음)가
// 있어 클라이언트에서 사람이 확인 후 저장하도록 원본 분석 결과 + 매칭 후보만 반환합니다.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const meetingId = params.id;
  try {
    await requireMeetingRole(req, meetingId, ["AUTHOR", "PARTICIPANT"]);

    const meetingSnap = await getAdminDb().collection("meetings").doc(meetingId).get();
    if (!meetingSnap.exists) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
    const meeting = meetingSnap.data()!;

    const segmentsSnap = await getAdminDb()
      .collection("transcripts")
      .doc(meetingId)
      .collection("segments")
      .orderBy("order", "asc")
      .get();
    const segments = segmentsSnap.docs.map((d) => d.data() as TranscriptSegment);
    if (segments.length === 0) {
      return NextResponse.json({ error: "분석할 회의록 텍스트가 없습니다." }, { status: 400 });
    }

    const result = await analyzeMeetingTranscript(segments, meeting.meeting_title, meeting.meeting_date);

    // 같은 회사 사용자 이름으로 매칭 후보 계산 (완전 일치만 자동 매칭, 나머지는 사용자가 화면에서 직접 지정)
    const usersSnap = await getAdminDb()
      .collection("users")
      .where("organization_id", "==", meeting.organization_id)
      .get();
    const users = usersSnap.docs.map((d) => d.data() as UserProfile);
    const findUserId = (name: string | null) => {
      if (!name) return null;
      const match = users.find((u) => u.user_name.trim() === name.trim());
      return match ? match.id : null;
    };

    const enriched = {
      summary: result.summary,
      topics: result.topics,
      questions: result.questions.map((q) => ({
        ...q,
        matched_questioner_id: findUserId(q.questioner_name),
        matched_assignee_id: findUserId(q.assignee_name),
      })),
      decisions: result.decisions,
      action_items: result.action_items.map((a) => ({
        ...a,
        matched_assignee_ids: a.assignee_names.map(findUserId).filter((v): v is string => !!v),
      })),
    };

    // 요약은 낮은 리스크이므로 바로 저장
    await getAdminDb()
      .collection("meetingSummaries")
      .doc(meetingId)
      .set({
        id: meetingId,
        meeting_id: meetingId,
        summary_text: result.summary,
        topics: result.topics,
        generated_by: "CLAUDE_AI",
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
        created_at: Date.now(),
      });

    await getAdminDb().collection("transcripts").doc(meetingId).update({
      transcript_status: "ANALYZED",
      updated_at: Date.now(),
    });

    return NextResponse.json(enriched);
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "AI 분석 중 오류가 발생했습니다." }, { status: 500 });
  }
}
