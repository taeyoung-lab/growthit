"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { authedFetch } from "@/lib/apiClient";
import { useDirectory } from "@/lib/firestore/useDirectory";
import { QUESTION_STATUS_LABEL, QUESTION_STATUS_BADGE, ACTION_ITEM_STATUS_LABEL } from "@/lib/statusLabels";
import type {
  ActionItem,
  ActionItemStatus,
  Answer,
  Meeting,
  MeetingSummary,
  MeetingUserPermission,
  Question,
  QuestionStatus,
} from "@/lib/types";

function MeetingDetailContent({ meetingId }: { meetingId: string }) {
  const { firebaseUser, profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answersByQuestion, setAnswersByQuestion] = useState<Record<string, Answer[]>>({});
  const [participants, setParticipants] = useState<MeetingUserPermission[]>([]);

  const [newQuestion, setNewQuestion] = useState("");
  const [newQuestionAssignee, setNewQuestionAssignee] = useState("");
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [newParticipantUid, setNewParticipantUid] = useState("");

  const isAdmin = profile?.org_role === "SUPER_ADMIN" || profile?.org_role === "ADMIN";
  const canEdit = myRole === "AUTHOR" || myRole === "PARTICIPANT" || profile?.org_role === "SUPER_ADMIN";
  const isAuthor = myRole === "AUTHOR" || profile?.org_role === "SUPER_ADMIN";

  const loadAll = useCallback(async () => {
    if (!firebaseUser) return;
    const mSnap = await getDoc(doc(db, "meetings", meetingId));
    if (!mSnap.exists()) return;
    setMeeting(mSnap.data() as Meeting);

    const permSnap = await getDoc(doc(db, "meetings", meetingId, "permissions", firebaseUser.uid));
    setMyRole(permSnap.exists() ? (permSnap.data().role as string) : null);

    const summarySnap = await getDoc(doc(db, "meetingSummaries", meetingId));
    setSummary(summarySnap.exists() ? (summarySnap.data() as MeetingSummary) : null);

    const [aSnap, qSnap, permsSnap] = await Promise.all([
      getDocs(query(collection(db, "actionItems"), where("meeting_id", "==", meetingId))),
      getDocs(query(collection(db, "questions"), where("meeting_id", "==", meetingId), orderBy("created_at", "asc"))),
      getDocs(collection(db, "meetings", meetingId, "permissions")),
    ]);
    setActionItems(aSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ActionItem)));
    const qs = qSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Question));
    setQuestions(qs);
    setParticipants(permsSnap.docs.map((d) => d.data() as MeetingUserPermission));

    const answerEntries = await Promise.all(
      qs.map(async (q) => {
        const ansSnap = await getDocs(query(collection(db, "questions", q.id, "answers"), orderBy("answered_at", "asc")));
        return [q.id, ansSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Answer))] as const;
      })
    );
    setAnswersByQuestion(Object.fromEntries(answerEntries));
  }, [firebaseUser, meetingId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function updateActionStatus(item: ActionItem, status: ActionItemStatus) {
    await updateDoc(doc(db, "actionItems", item.id), { status, updated_at: Date.now() });
    setActionItems((prev) => prev.map((a) => (a.id === item.id ? { ...a, status } : a)));
  }

  async function postQuestion() {
    if (!firebaseUser || !meeting || !newQuestion.trim()) return;
    const now = Date.now();
    const ref = doc(collection(db, "questions"));
    await setDoc(ref, {
      id: ref.id,
      meeting_id: meetingId,
      project_id: meeting.project_id,
      organization_id: meeting.organization_id,
      questioner_user_id: firebaseUser.uid,
      assignee_user_id: newQuestionAssignee || null,
      question_content: newQuestion.trim(),
      question_status: "ANSWER_PENDING",
      due_date: null,
      created_at: now,
      updated_at: now,
    });
    setNewQuestion("");
    setNewQuestionAssignee("");
    loadAll();
  }

  async function postAnswer(q: Question) {
    if (!firebaseUser) return;
    const content = replyDraft[q.id]?.trim();
    if (!content) return;
    const now = Date.now();
    await addDoc(collection(db, "questions", q.id, "answers"), {
      question_id: q.id,
      answerer_user_id: firebaseUser.uid,
      answer_content: content,
      source_meeting_id: meetingId,
      answered_at: now,
      created_at: now,
      updated_at: now,
    });
    await updateDoc(doc(db, "questions", q.id), { question_status: "ANSWERED", updated_at: now });
    setReplyDraft((prev) => ({ ...prev, [q.id]: "" }));
    loadAll();
  }

  async function updateQuestionStatus(q: Question, status: QuestionStatus) {
    await updateDoc(doc(db, "questions", q.id), { question_status: status, updated_at: Date.now() });
    loadAll();
  }

  async function addParticipant() {
    if (!newParticipantUid) return;
    try {
      await authedFetch(`/api/meetings/${meetingId}/participants`, {
        method: "POST",
        body: JSON.stringify({ user_id: newParticipantUid }),
      });
      setNewParticipantUid("");
      loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "참여자 지정 실패");
    }
  }

  if (!meeting) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <p className="p-8 text-center text-sm text-gray-400">불러오는 중이거나 접근 권한이 없습니다.</p>
      </div>
    );
  }

  const orgUserOptions = Object.values(dir.users).filter((u) => !participants.some((p) => p.user_id === u.id));

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-navy">{meeting.meeting_title}</h1>
            <p className="text-sm text-gray-400">
              {meeting.meeting_date} {meeting.meeting_start_time ? `· ${meeting.meeting_start_time}` : ""} · {meeting.location || "장소 미기재"} · 내 권한: {myRole || (isAdmin ? "관리자(전체 열람)" : "없음")}
            </p>
          </div>
          {isAuthor && (
            <Link href={`/meetings/${meetingId}/share`} className="btn btn-secondary text-xs">
              열람자 공유 관리
            </Link>
          )}
        </div>

        {/* (1) 개요 */}
        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">1. 개요</h2>
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="mb-1 font-medium text-gray-500">참석자 — {meeting.attendees.client_company_name || "고객사"}</p>
              {meeting.attendees.client_attendees.length > 0 ? (
                <ul className="text-ink">
                  {meeting.attendees.client_attendees.map((a, i) => (
                    <li key={i}>{a.name} {a.title && `(${a.title})`}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-400">참석자 없음</p>
              )}
            </div>
            <div>
              <p className="mb-1 font-medium text-gray-500">참석자 — 와일리</p>
              {meeting.attendees.wylie_attendees.length > 0 ? (
                <ul className="text-ink">
                  {meeting.attendees.wylie_attendees.map((a, i) => (
                    <li key={i}>{a.name} {a.title && `(${a.title})`}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-400">참석자 없음</p>
              )}
            </div>
          </div>
        </section>

        {/* (2) 회의 요약 */}
        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">2. 회의 요약</h2>
          <p className="whitespace-pre-line text-sm text-ink">{summary?.summary_text || "요약이 입력되지 않았습니다."}</p>
        </section>

        {/* (3) 논의내용 */}
        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">3. 논의내용</h2>
          {summary && summary.topics.length > 0 ? (
            summary.topics.map((t, i) => (
              <div key={i} className="mb-3">
                <p className="text-sm font-semibold text-navy">{t.title}</p>
                <p className="whitespace-pre-line text-sm text-gray-600">{t.content}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-400">등록된 논의내용이 없습니다.</p>
          )}
        </section>

        {/* (4) 향후추진과제 */}
        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">4. 향후추진과제</h2>
          <div className="flex flex-col gap-2">
            {actionItems.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{a.title}</p>
                  <p className="text-xs text-gray-400">
                    담당 {a.assignee_user_ids.map((id) => dir.displayName(id)).join(", ") || "미지정"} · 기한 {a.due_date || "없음"}
                    {a.description && ` · ${a.description}`}
                  </p>
                </div>
                {canEdit ? (
                  <select
                    className="input w-28 text-xs"
                    value={a.status}
                    onChange={(e) => updateActionStatus(a, e.target.value as ActionItemStatus)}
                  >
                    {Object.entries(ACTION_ITEM_STATUS_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <span className="badge badge-progress">{ACTION_ITEM_STATUS_LABEL[a.status]}</span>
                )}
              </div>
            ))}
            {actionItems.length === 0 && <p className="text-sm text-gray-400">등록된 향후추진과제가 없습니다.</p>}
          </div>
        </section>

        {/* (5) 문답 (Q&A) */}
        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">5. 문답 (Q&A)</h2>
          <div className="flex flex-col gap-4">
            {questions.map((q) => (
              <div key={q.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start justify-between">
                  <span className={`badge ${QUESTION_STATUS_BADGE[q.question_status]}`}>{QUESTION_STATUS_LABEL[q.question_status]}</span>
                  {canEdit && (
                    <select
                      className="rounded border border-gray-200 text-xs"
                      value={q.question_status}
                      onChange={(e) => updateQuestionStatus(q, e.target.value as QuestionStatus)}
                    >
                      {Object.entries(QUESTION_STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="mt-2 text-sm text-ink">{q.question_content}</p>
                <div className="mt-1 flex gap-4 text-xs text-gray-400">
                  <span>질문자 {dir.displayName(q.questioner_user_id)}</span>
                  <span>담당 {dir.displayName(q.assignee_user_id)}</span>
                </div>

                {(answersByQuestion[q.id] || []).map((ans) => (
                  <div key={ans.id} className="mt-2 rounded-lg bg-gray-50 p-3 text-sm">
                    <p className="text-ink">{ans.answer_content}</p>
                    <p className="mt-1 text-xs text-gray-400">답변자 {dir.displayName(ans.answerer_user_id)}</p>
                  </div>
                ))}

                {q.question_status !== "CLOSED" && (
                  <div className="mt-2 flex gap-2">
                    <input
                      className="input flex-1 text-xs"
                      placeholder="답변 입력"
                      value={replyDraft[q.id] || ""}
                      onChange={(e) => setReplyDraft((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    />
                    <button className="btn btn-secondary text-xs" onClick={() => postAnswer(q)}>답변 등록</button>
                  </div>
                )}
              </div>
            ))}
            {questions.length === 0 && <p className="text-sm text-gray-400">등록된 문답이 없습니다.</p>}

            <div className="rounded-lg bg-gray-50 p-4">
              <p className="mb-2 text-sm font-medium text-ink">새 질문 등록</p>
              <textarea
                className="input mb-2 w-full text-sm"
                placeholder="질문 내용을 입력하세요."
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
              />
              <div className="flex gap-2">
                <select className="input text-xs" value={newQuestionAssignee} onChange={(e) => setNewQuestionAssignee(e.target.value)}>
                  <option value="">담당자 미지정</option>
                  {Object.values(dir.users).map((u) => (
                    <option key={u.id} value={u.id}>{u.user_name}</option>
                  ))}
                </select>
                <button className="btn btn-primary text-xs" onClick={postQuestion} disabled={!newQuestion.trim()}>등록</button>
              </div>
            </div>
          </div>
        </section>

        {/* 참여자 관리 (편집자 전용) */}
        {isAuthor && (
          <section className="card p-6">
            <h2 className="mb-3 font-semibold text-ink">참여자 관리</h2>
            <div className="mb-3 flex flex-col gap-1 text-sm">
              {participants.map((p) => (
                <div key={p.user_id} className="flex justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <span>{dir.displayName(p.user_id)}</span>
                  <span className="text-gray-400">{p.role === "AUTHOR" ? "편집자" : p.role === "PARTICIPANT" ? "참여자" : "열람자"}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <select className="input" value={newParticipantUid} onChange={(e) => setNewParticipantUid(e.target.value)}>
                <option value="">참여자로 지정할 사용자 선택</option>
                {orgUserOptions.map((u) => (
                  <option key={u.id} value={u.id}>{u.user_name}</option>
                ))}
              </select>
              <button className="btn btn-secondary text-xs" onClick={addParticipant} disabled={!newParticipantUid}>참여자 추가</button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function MeetingDetailPage({ params }: { params: { id: string } }) {
  return (
    <AuthGate>
      <MeetingDetailContent meetingId={params.id} />
    </AuthGate>
  );
}
