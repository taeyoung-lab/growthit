
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifyShareProof } from "@/lib/shareProof";
import type { ActionItem, Answer, Meeting, MeetingSummary, Question } from "@/lib/types";

// 공유 링크 전용 "읽기 전용" 콘텐츠 API.
// 일반 Firestore 보안규칙/클라이언트 SDK를 전혀 거치지 않고 Admin SDK로 서버에서만 조회한 뒤,
// 딱 이 화면에 필요한 값만 내려줍니다 — 공유 대상자는 이 API 하나만 호출할 수 있고, 그 외
// 어떤 페이지나 다른 회의/프로젝트 데이터에도 접근할 방법이 없습니다.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const proof = req.nextUrl.searchParams.get("proof");
  const token = params.token;

  const shareQuery = await getAdminDb()
    .collectionGroup("shares")
    .where("share_token", "==", token)
    .limit(1)
    .get();
  if (shareQuery.empty) {
    return NextResponse.json({ error: "유효하지 않은 공유 링크입니다." }, { status: 404 });
  }

  const shareDoc = shareQuery.docs[0];
  const share = shareDoc.data();

  if (share.share_status === "REVOKED") {
    return NextResponse.json({ error: "공유가 취소되었습니다." }, { status: 403 });
  }
  if (share.share_status !== "ACTIVE" || share.expires_at < Date.now()) {
    return NextResponse.json({ error: "공유 기간이 만료되었습니다." }, { status: 403 });
  }
  if (!verifyShareProof(proof, shareDoc.id, share.expires_at)) {
    return NextResponse.json({ error: "인증이 만료되었거나 유효하지 않습니다. 다시 접속해주세요." }, { status: 401 });
  }

  const meetingId = share.meeting_id as string;
  const db = getAdminDb();

  const [meetingSnap, summarySnap, actionItemsSnap, questionsSnap] = await Promise.all([
    db.collection("meetings").doc(meetingId).get(),
    db.collection("meetingSummaries").doc(meetingId).get(),
    db.collection("actionItems").where("meeting_id", "==", meetingId).get(),
    db.collection("questions").where("meeting_id", "==", meetingId).orderBy("created_at", "asc").get(),
  ]);

  if (!meetingSnap.exists) {
    return NextResponse.json({ error: "회의록을 찾을 수 없습니다." }, { status: 404 });
  }

  const meeting = meetingSnap.data() as Meeting;
  const summary = summarySnap.exists ? (summarySnap.data() as MeetingSummary) : null;
  const actionItems = actionItemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ActionItem));
  const questions = questionsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Question));

  // 문답별 답변 + 표시에 필요한 사용자 이름을 한 번에 모읍니다.
  const answersByQuestion = await Promise.all(
    questions.map(async (q) => {
      const ansSnap = await db.collection("questions").doc(q.id).collection("answers").orderBy("answered_at", "asc").get();
      return [q.id, ansSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Answer))] as const;
    })
  );
  const answersMap = Object.fromEntries(answersByQuestion);

  const userIds = new Set<string>();
  actionItems.forEach((a) => a.assignee_user_ids.forEach((id) => userIds.add(id)));
  questions.forEach((q) => {
    userIds.add(q.questioner_user_id);
    if (q.assignee_user_id) userIds.add(q.assignee_user_id);
  });
  Object.values(answersMap).forEach((answers) => answers.forEach((a) => userIds.add(a.answerer_user_id)));

  const nameById: Record<string, string> = {};
  await Promise.all(
    Array.from(userIds).map(async (uid) => {
      const snap = await db.collection("users").doc(uid).get();
      nameById[uid] = snap.exists ? (snap.data()?.user_name as string) || "알 수 없음" : "알 수 없음";
    })
  );
  const displayName = (uid: string | null | undefined) => (uid ? nameById[uid] || "알 수 없음" : "미지정");

  return NextResponse.json({
    permission: share.permission,
    meeting: {
      title: meeting.meeting_title,
      date: meeting.meeting_date,
      start_time: meeting.meeting_start_time || null,
      location: meeting.location || null,
      client_company_name: meeting.attendees.client_company_name || null,
      client_attendees: meeting.attendees.client_attendees,
      wylie_attendees: meeting.attendees.wylie_attendees,
    },
    summary: {
      summary_text: summary?.summary_text || null,
      topics: summary?.topics || [],
    },
    action_items: actionItems.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description || null,
      due_date: a.due_date || null,
      status: a.status,
      assignees: a.assignee_user_ids.map(displayName),
    })),
    qna: questions.map((q) => ({
      id: q.id,
      question_content: q.question_content,
      question_status: q.question_status,
      questioner_name: displayName(q.questioner_user_id),
      assignee_name: displayName(q.assignee_user_id),
      answers: (answersMap[q.id] || []).map((a) => ({
        answer_content: a.answer_content,
        answerer_name: displayName(a.answerer_user_id),
      })),
    })),
  });
}
