
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifyShareProof } from "@/lib/shareProof";

// 공유 링크로 접속한 "참여자(PARTICIPANT)" 권한 대상자가 질문을 등록하거나 답변을 남길 때
// 쓰는 전용 API. VIEWER(열람자) 권한이면 거부합니다. 이 요청도 Firebase 로그인 없이,
// share 문서에 묶인 proof로만 인증합니다 — 성공해도 다른 페이지/데이터에는 접근할 수 없습니다.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const body = await req.json();
  const { proof, action, question_content, question_id, answer_content } = body;
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

  if (share.share_status !== "ACTIVE" || share.expires_at < Date.now()) {
    return NextResponse.json({ error: "공유 기간이 만료되었거나 취소되었습니다." }, { status: 403 });
  }
  if (!verifyShareProof(proof, shareDoc.id, share.expires_at)) {
    return NextResponse.json({ error: "인증이 만료되었거나 유효하지 않습니다. 다시 접속해주세요." }, { status: 401 });
  }
  if (share.permission !== "PARTICIPANT") {
    return NextResponse.json({ error: "열람자 권한으로는 질문/답변을 등록할 수 없습니다." }, { status: 403 });
  }

  const meetingId = share.meeting_id as string;
  const userId = share.user_id as string;
  const db = getAdminDb();
  const now = Date.now();

  if (action === "question") {
    if (!question_content || !String(question_content).trim()) {
      return NextResponse.json({ error: "질문 내용을 입력하세요." }, { status: 400 });
    }
    const meetingSnap = await db.collection("meetings").doc(meetingId).get();
    if (!meetingSnap.exists) return NextResponse.json({ error: "회의록을 찾을 수 없습니다." }, { status: 404 });
    const meeting = meetingSnap.data()!;

    const ref = db.collection("questions").doc();
    await ref.set({
      id: ref.id,
      meeting_id: meetingId,
      project_id: meeting.project_id,
      organization_id: meeting.organization_id,
      questioner_user_id: userId,
      assignee_user_id: null,
      question_content: String(question_content).trim(),
      question_status: "ANSWER_PENDING",
      due_date: null,
      created_at: now,
      updated_at: now,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "answer") {
    if (!question_id || !answer_content || !String(answer_content).trim()) {
      return NextResponse.json({ error: "답변 내용을 입력하세요." }, { status: 400 });
    }
    const qSnap = await db.collection("questions").doc(question_id).get();
    if (!qSnap.exists || qSnap.data()?.meeting_id !== meetingId) {
      return NextResponse.json({ error: "질문을 찾을 수 없습니다." }, { status: 404 });
    }
    await db.collection("questions").doc(question_id).collection("answers").add({
      question_id,
      answerer_user_id: userId,
      answer_content: String(answer_content).trim(),
      source_meeting_id: meetingId,
      answered_at: now,
      created_at: now,
      updated_at: now,
    });
    await db.collection("questions").doc(question_id).update({ question_status: "ANSWERED", updated_at: now });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "알 수 없는 action입니다." }, { status: 400 });
}
