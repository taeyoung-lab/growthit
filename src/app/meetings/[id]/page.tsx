"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  addDoc,
  collection,
  deleteDoc,
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
  Decision,
  DecisionHistoryEntry,
  DecisionStatus,
  Meeting,
  MeetingRelation,
  MeetingSummary,
  MeetingUserPermission,
  Question,
  QuestionStatus,
} from "@/lib/types";

const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  ACTIVE: "유효",
  SUPERSEDED: "변경됨",
  CANCELLED: "취소됨",
};

interface RelatedMeetingLink {
  direction: "이전 회의" | "후속 회의";
  meetingId: string;
  title: string;
  date: string;
}

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
  const [relatedMeetings, setRelatedMeetings] = useState<RelatedMeetingLink[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionHistory, setDecisionHistory] = useState<Record<string, DecisionHistoryEntry[]>>({});
  const [openHistoryFor, setOpenHistoryFor] = useState<string | null>(null);
  const [newDecisionTitle, setNewDecisionTitle] = useState("");
  const [newDecisionContent, setNewDecisionContent] = useState("");
  const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editReason, setEditReason] = useState("");

  const [newQuestion, setNewQuestion] = useState("");
  const [newQuestionAssignee, setNewQuestionAssignee] = useState("");
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [newParticipantUid, setNewParticipantUid] = useState("");
  const [newParticipantRole, setNewParticipantRole] = useState<"AUTHOR" | "PARTICIPANT" | "VIEWER">("PARTICIPANT");
  const [participantSaving, setParticipantSaving] = useState<string | null>(null);

  // 향후추진과제 수정/추가
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editActionTitle, setEditActionTitle] = useState("");
  const [editActionDescription, setEditActionDescription] = useState("");
  const [editActionDueDate, setEditActionDueDate] = useState("");
  const [editActionAssignees, setEditActionAssignees] = useState<string[]>([]);
  const [newActionTitle, setNewActionTitle] = useState("");
  const [newActionDescription, setNewActionDescription] = useState("");
  const [newActionDueDate, setNewActionDueDate] = useState("");
  const [newActionAssignees, setNewActionAssignees] = useState<string[]>([]);

  // 문답(Q&A) 수정
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editQuestionContent, setEditQuestionContent] = useState("");
  const [editQuestionAssignee, setEditQuestionAssignee] = useState("");

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

    // 이전/이후 회의 연결 — 회의 작성 시 "이전 회의와 연결"로 저장된 관계를 양방향으로 표시합니다.
    // (지금까지는 저장만 되고 상세 화면에서 전혀 보이지 않던 부분)
    const [asChildSnap, asParentSnap] = await Promise.all([
      getDocs(query(collection(db, "meetingRelations"), where("child_meeting_id", "==", meetingId))),
      getDocs(query(collection(db, "meetingRelations"), where("parent_meeting_id", "==", meetingId))),
    ]);
    const relations = [
      ...asChildSnap.docs.map((d) => ({ rel: d.data() as MeetingRelation, direction: "이전 회의" as const, otherId: (d.data() as MeetingRelation).parent_meeting_id })),
      ...asParentSnap.docs.map((d) => ({ rel: d.data() as MeetingRelation, direction: "후속 회의" as const, otherId: (d.data() as MeetingRelation).child_meeting_id })),
    ];
    const relatedDocs = await Promise.all(relations.map((r) => getDoc(doc(db, "meetings", r.otherId))));
    setRelatedMeetings(
      relations
        .map((r, i) => {
          const otherSnap = relatedDocs[i];
          if (!otherSnap.exists()) return null;
          const other = otherSnap.data() as Meeting;
          return { direction: r.direction, meetingId: r.otherId, title: other.meeting_title, date: other.meeting_date };
        })
        .filter((v): v is RelatedMeetingLink => v !== null)
    );

    // 결정사항 (16장) — 타입/보안규칙은 있었지만 화면이 없던 부분
    const decisionsSnap = await getDocs(query(collection(db, "decisions"), where("meeting_id", "==", meetingId)));
    setDecisions(decisionsSnap.docs.map((d) => d.data() as Decision));
  }, [firebaseUser, meetingId]);

  async function loadDecisionHistory(decisionId: string) {
    if (openHistoryFor === decisionId) {
      setOpenHistoryFor(null);
      return;
    }
    const snap = await getDocs(
      query(collection(db, "decisions", decisionId, "history"), orderBy("changed_at", "desc"))
    );
    setDecisionHistory((prev) => ({ ...prev, [decisionId]: snap.docs.map((d) => d.data() as DecisionHistoryEntry) }));
    setOpenHistoryFor(decisionId);
  }

  async function addDecision() {
    if (!firebaseUser || !meeting || !newDecisionTitle.trim() || !newDecisionContent.trim()) return;
    const now = Date.now();
    const ref = doc(collection(db, "decisions"));
    await setDoc(ref, {
      id: ref.id,
      meeting_id: meetingId,
      project_id: meeting.project_id,
      organization_id: meeting.organization_id,
      decision_title: newDecisionTitle.trim(),
      decision_content: newDecisionContent.trim(),
      decision_status: "ACTIVE",
      version: 1,
      // 회의의 현재 member_uids를 그대로 복사 (LIST 쿼리 보안 규칙 제약 우회용 — firestore.rules 참고)
      member_uids: meeting.member_uids,
      created_at: now,
      updated_at: now,
    } satisfies Decision);
    setNewDecisionTitle("");
    setNewDecisionContent("");
    loadAll();
  }

  function startEditDecision(d: Decision) {
    setEditingDecisionId(d.id);
    setEditTitle(d.decision_title);
    setEditContent(d.decision_content);
    setEditReason("");
  }

  async function saveDecisionEdit(d: Decision) {
    if (!firebaseUser || !editTitle.trim() || !editContent.trim()) return;
    const now = Date.now();
    // 변경 전 내용을 이력에 먼저 남깁니다(append-only — 덮어쓰지 않음).
    await addDoc(collection(db, "decisions", d.id, "history"), {
      decision_id: d.id,
      previous_content: d.decision_content,
      previous_title: d.decision_title,
      change_reason: editReason.trim() || "사유 미입력",
      changed_by_user_id: firebaseUser.uid,
      changed_at: now,
      meeting_id: meetingId,
    });
    await updateDoc(doc(db, "decisions", d.id), {
      decision_title: editTitle.trim(),
      decision_content: editContent.trim(),
      version: d.version + 1,
      updated_at: now,
    });
    setEditingDecisionId(null);
    loadAll();
  }

  async function changeDecisionStatus(d: Decision, status: DecisionStatus) {
    await updateDoc(doc(db, "decisions", d.id), { decision_status: status, updated_at: Date.now() });
    loadAll();
  }

  async function deleteDecision(d: Decision) {
    if (!confirm(`"${d.decision_title}" 결정사항을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    // 변경이력(history)은 append-only 원칙에 따라 삭제하지 않고 그대로 둡니다(보안규칙에서도
    // history의 delete를 막아둠 — firestore.rules 참고). 부모 문서가 없어지면 화면에서
    // 어차피 조회되지 않으므로 실질적인 영향은 없습니다.
    await deleteDoc(doc(db, "decisions", d.id));
    if (editingDecisionId === d.id) setEditingDecisionId(null);
    loadAll();
  }

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function updateActionStatus(item: ActionItem, status: ActionItemStatus) {
    await updateDoc(doc(db, "actionItems", item.id), { status, updated_at: Date.now() });
    setActionItems((prev) => prev.map((a) => (a.id === item.id ? { ...a, status } : a)));
  }

  async function addActionItem() {
    if (!firebaseUser || !meeting || !newActionTitle.trim()) return;
    const now = Date.now();
    const ref = doc(collection(db, "actionItems"));
    await setDoc(ref, {
      id: ref.id,
      meeting_id: meetingId,
      project_id: meeting.project_id,
      organization_id: meeting.organization_id,
      title: newActionTitle.trim(),
      description: newActionDescription.trim(),
      status: "TODO",
      due_date: newActionDueDate || null,
      created_by_user_id: firebaseUser.uid,
      assignee_user_ids: newActionAssignees,
      // 회의의 현재 member_uids를 그대로 복사 (LIST 쿼리 보안 규칙 제약 우회용 — firestore.rules 참고)
      member_uids: meeting.member_uids,
      created_at: now,
      updated_at: now,
    } satisfies ActionItem);
    setNewActionTitle("");
    setNewActionDescription("");
    setNewActionDueDate("");
    setNewActionAssignees([]);
    loadAll();
  }

  function startEditAction(a: ActionItem) {
    setEditingActionId(a.id);
    setEditActionTitle(a.title);
    setEditActionDescription(a.description);
    setEditActionDueDate(a.due_date || "");
    setEditActionAssignees(a.assignee_user_ids);
  }

  async function saveActionEdit(a: ActionItem) {
    if (!editActionTitle.trim()) return;
    await updateDoc(doc(db, "actionItems", a.id), {
      title: editActionTitle.trim(),
      description: editActionDescription.trim(),
      due_date: editActionDueDate || null,
      assignee_user_ids: editActionAssignees,
      updated_at: Date.now(),
    });
    setEditingActionId(null);
    loadAll();
  }

  async function deleteActionItem(a: ActionItem) {
    if (!confirm(`"${a.title}" 향후추진과제를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await deleteDoc(doc(db, "actionItems", a.id));
    loadAll();
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
      // 회의의 현재 member_uids를 그대로 복사 (LIST 쿼리 보안 규칙 제약 우회용 — firestore.rules 참고)
      member_uids: meeting.member_uids,
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

  function startEditQuestion(q: Question) {
    setEditingQuestionId(q.id);
    setEditQuestionContent(q.question_content);
    setEditQuestionAssignee(q.assignee_user_id || "");
  }

  async function saveQuestionEdit(q: Question) {
    if (!editQuestionContent.trim()) return;
    await updateDoc(doc(db, "questions", q.id), {
      question_content: editQuestionContent.trim(),
      assignee_user_id: editQuestionAssignee || null,
      updated_at: Date.now(),
    });
    setEditingQuestionId(null);
    loadAll();
  }

  async function deleteQuestion(q: Question) {
    if (!confirm("이 질문을 삭제할까요? 되돌릴 수 없습니다.")) return;
    // 답변(answers)은 각 답변 작성자 본인만 삭제할 수 있도록 보안규칙이 막아두고 있어
    // (firestore.rules 참고), 다른 사람이 단 답변까지 이 화면에서 일괄 삭제할 수는 없습니다.
    // 질문 문서만 삭제하며, 남은 답변은 부모가 없으면 화면에서 조회되지 않습니다.
    await deleteDoc(doc(db, "questions", q.id));
    loadAll();
  }

  async function addParticipant() {
    if (!newParticipantUid) return;
    try {
      await authedFetch(`/api/meetings/${meetingId}/participants`, {
        method: "POST",
        body: JSON.stringify({ user_id: newParticipantUid, role: newParticipantRole }),
      });
      setNewParticipantUid("");
      setNewParticipantRole("PARTICIPANT");
      loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "참여자 지정 실패");
    }
  }

  async function changeParticipantRole(p: MeetingUserPermission, role: "AUTHOR" | "PARTICIPANT" | "VIEWER") {
    setParticipantSaving(p.user_id);
    try {
      await authedFetch(`/api/meetings/${meetingId}/participants`, {
        method: "POST",
        body: JSON.stringify({ user_id: p.user_id, role }),
      });
      loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "역할 변경 실패");
    } finally {
      setParticipantSaving(null);
    }
  }

  async function removeParticipant(p: MeetingUserPermission) {
    if (!confirm(`${dir.displayName(p.user_id)}님을 이 회의 참여자에서 제외할까요?`)) return;
    setParticipantSaving(p.user_id);
    try {
      await authedFetch(`/api/meetings/${meetingId}/participants?user_id=${encodeURIComponent(p.user_id)}`, {
        method: "DELETE",
      });
      loadAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : "참여자 제외 실패");
    } finally {
      setParticipantSaving(null);
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
  // 향후추진과제 담당주체로 회의 참석자 섹션의 고객사 참석자도 지정할 수 있게 합니다
  // (회의록 작성 화면과 동일한 방식 — src/app/meetings/new/page.tsx 참고).
  const clientAttendeeOptions = meeting.attendees.client_attendees
    .filter((a) => a.name.trim())
    .map((a) => ({
      value: `client::${meeting.attendees.client_company_name.trim() || "고객사"}::${a.name.trim()}`,
      label: `${a.name.trim()}${a.title.trim() ? ` (${a.title.trim()})` : ""}`,
    }));
  const allOrgUsers = Object.values(dir.users);

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

        {relatedMeetings.length > 0 && (
          <section className="card mb-6 p-4">
            <p className="mb-2 text-xs font-medium text-gray-500">연결된 회의</p>
            <div className="flex flex-col gap-1">
              {relatedMeetings.map((r) => (
                <Link key={r.meetingId} href={`/meetings/${r.meetingId}`} className="text-sm text-navy hover:underline">
                  {r.direction === "이전 회의" ? "← 이전 회의: " : "→ 후속 회의: "}{r.date} · {r.title}
                </Link>
              ))}
            </div>
          </section>
        )}

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
            {actionItems.map((a) =>
              editingActionId === a.id ? (
                <div key={a.id} className="rounded-lg border border-gray-200 p-3">
                  <input className="input mb-2 w-full text-sm" placeholder="주요 추진과제" value={editActionTitle} onChange={(e) => setEditActionTitle(e.target.value)} />
                  <input className="input mb-2 w-full text-sm" placeholder="비고" value={editActionDescription} onChange={(e) => setEditActionDescription(e.target.value)} />
                  <div className="mb-2 flex gap-2">
                    <input type="date" className="input text-sm" value={editActionDueDate} onChange={(e) => setEditActionDueDate(e.target.value)} />
                    <select
                      multiple
                      size={4}
                      className="input flex-1 text-xs"
                      value={editActionAssignees}
                      onChange={(e) => setEditActionAssignees(Array.from(e.target.selectedOptions).map((o) => o.value))}
                    >
                      <optgroup label="와일리">
                        {allOrgUsers.map((u) => (
                          <option key={u.id} value={u.id}>{u.user_name}</option>
                        ))}
                      </optgroup>
                      {clientAttendeeOptions.length > 0 && (
                        <optgroup label={meeting.attendees.client_company_name || "고객사"}>
                          {clientAttendeeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary text-xs" onClick={() => saveActionEdit(a)} disabled={!editActionTitle.trim()}>저장</button>
                    <button className="btn btn-secondary text-xs" onClick={() => setEditingActionId(null)}>취소</button>
                  </div>
                </div>
              ) : (
                <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{a.title}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      담당 {a.assignee_user_ids.map((id) => dir.displayName(id)).join(", ") || "미지정"} · 기한 {a.due_date || "없음"}
                      {a.description && ` · ${a.description}`}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5">
                    {canEdit ? (
                      <select
                        className="input w-24 flex-shrink-0 text-xs"
                        value={a.status}
                        onChange={(e) => updateActionStatus(a, e.target.value as ActionItemStatus)}
                      >
                        {Object.entries(ACTION_ITEM_STATUS_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="badge badge-progress flex-shrink-0">{ACTION_ITEM_STATUS_LABEL[a.status]}</span>
                    )}
                    {canEdit && (
                      <button className="btn btn-secondary text-xs" onClick={() => startEditAction(a)}>수정</button>
                    )}
                    {isAuthor && (
                      <button className="btn btn-secondary text-xs" onClick={() => deleteActionItem(a)}>삭제</button>
                    )}
                  </div>
                </div>
              )
            )}
            {actionItems.length === 0 && <p className="text-sm text-gray-400">등록된 향후추진과제가 없습니다.</p>}

            {canEdit && (
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="mb-2 text-sm font-medium text-ink">새 향후추진과제 추가</p>
                <input className="input mb-2 w-full text-sm" placeholder="주요 추진과제" value={newActionTitle} onChange={(e) => setNewActionTitle(e.target.value)} />
                <input className="input mb-2 w-full text-sm" placeholder="비고 (선택)" value={newActionDescription} onChange={(e) => setNewActionDescription(e.target.value)} />
                <div className="mb-2 flex gap-2">
                  <input type="date" className="input text-sm" value={newActionDueDate} onChange={(e) => setNewActionDueDate(e.target.value)} />
                  <select
                    multiple
                    size={4}
                    className="input flex-1 text-xs"
                    value={newActionAssignees}
                    onChange={(e) => setNewActionAssignees(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  >
                    <optgroup label="와일리">
                      {allOrgUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.user_name}</option>
                      ))}
                    </optgroup>
                    {clientAttendeeOptions.length > 0 && (
                      <optgroup label={meeting.attendees.client_company_name || "고객사"}>
                        {clientAttendeeOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <p className="mb-2 text-[11px] text-gray-400">
                  {newActionAssignees.length > 0 ? `선택됨: ${newActionAssignees.map((id) => dir.displayName(id)).join(", ")}` : "Ctrl(⌘)+클릭으로 여러 명 선택 가능"}
                </p>
                <button className="btn btn-primary text-xs" onClick={addActionItem} disabled={!newActionTitle.trim()}>등록</button>
              </div>
            )}
          </div>
        </section>

        {/* 결정사항 */}
        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">결정사항</h2>
          <div className="flex flex-col gap-3">
            {decisions.map((d) => (
              <div key={d.id} className="rounded-lg border border-gray-200 p-4">
                {editingDecisionId === d.id ? (
                  <div className="flex flex-col gap-2">
                    <input className="input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="제목" />
                    <textarea className="input" value={editContent} onChange={(e) => setEditContent(e.target.value)} placeholder="내용" />
                    <input className="input" value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="변경 사유 (예: 고객 요청으로 일정 변경)" />
                    <div className="flex gap-2">
                      <button className="btn btn-primary text-xs" onClick={() => saveDecisionEdit(d)}>저장 (버전 {d.version + 1})</button>
                      <button className="btn btn-secondary text-xs" onClick={() => setEditingDecisionId(null)}>취소</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-ink">{d.decision_title} <span className="text-xs text-gray-400">v{d.version}</span></p>
                        <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{d.decision_content}</p>
                      </div>
                      <span className={`badge ${d.decision_status === "ACTIVE" ? "badge-answered" : "badge-closed"}`}>
                        {DECISION_STATUS_LABEL[d.decision_status]}
                      </span>
                    </div>
                    {canEdit && (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <button className="btn btn-secondary text-xs" onClick={() => startEditDecision(d)}>수정</button>
                        {d.decision_status !== "SUPERSEDED" && (
                          <button className="btn btn-secondary text-xs" onClick={() => changeDecisionStatus(d, "SUPERSEDED")}>변경됨으로 표시</button>
                        )}
                        {d.decision_status !== "CANCELLED" && (
                          <button className="btn btn-secondary text-xs" onClick={() => changeDecisionStatus(d, "CANCELLED")}>취소 처리</button>
                        )}
                        {d.decision_status !== "ACTIVE" && (
                          <button className="btn btn-secondary text-xs" onClick={() => changeDecisionStatus(d, "ACTIVE")}>유효로 되돌리기</button>
                        )}
                        <button className="text-gray-400 underline" onClick={() => loadDecisionHistory(d.id)}>
                          변경이력 {openHistoryFor === d.id ? "숨기기" : "보기"}
                        </button>
                        {isAuthor && (
                          <button className="text-red-500 underline" onClick={() => deleteDecision(d)}>삭제</button>
                        )}
                      </div>
                    )}
                    {openHistoryFor === d.id && (
                      <div className="mt-2 flex flex-col gap-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                        {(decisionHistory[d.id] || []).map((h, i) => (
                          <p key={i}>
                            {new Date(h.changed_at).toLocaleString("ko-KR")} — &quot;{h.previous_title}&quot;에서 변경 (사유: {h.change_reason})
                          </p>
                        ))}
                        {(decisionHistory[d.id] || []).length === 0 && <p>변경 이력이 없습니다.</p>}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {decisions.length === 0 && <p className="text-sm text-gray-400">등록된 결정사항이 없습니다.</p>}

            {canEdit && (
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="mb-2 text-sm font-medium text-ink">새 결정사항 등록</p>
                <input className="input mb-2 w-full text-sm" placeholder="제목" value={newDecisionTitle} onChange={(e) => setNewDecisionTitle(e.target.value)} />
                <textarea className="input mb-2 w-full text-sm" placeholder="내용" value={newDecisionContent} onChange={(e) => setNewDecisionContent(e.target.value)} />
                <button className="btn btn-primary text-xs" onClick={addDecision} disabled={!newDecisionTitle.trim() || !newDecisionContent.trim()}>등록</button>
              </div>
            )}
          </div>
        </section>

        {/* (5) 문답 (Q&A) */}
        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">5. 문답 (Q&A)</h2>
          <div className="flex flex-col gap-4">
            {questions.map((q) => (
              <div key={q.id} className="rounded-lg border border-gray-200 p-4">
                {editingQuestionId === q.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea className="input" value={editQuestionContent} onChange={(e) => setEditQuestionContent(e.target.value)} placeholder="질문 내용" />
                    <select className="input text-xs" value={editQuestionAssignee} onChange={(e) => setEditQuestionAssignee(e.target.value)}>
                      <option value="">담당자 미지정</option>
                      {allOrgUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.user_name}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button className="btn btn-primary text-xs" onClick={() => saveQuestionEdit(q)} disabled={!editQuestionContent.trim()}>저장</button>
                      <button className="btn btn-secondary text-xs" onClick={() => setEditingQuestionId(null)}>취소</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className={`badge ${QUESTION_STATUS_BADGE[q.question_status]}`}>{QUESTION_STATUS_LABEL[q.question_status]}</span>
                      <div className="flex flex-shrink-0 items-center gap-1.5">
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
                        {canEdit && (
                          <button className="btn btn-secondary text-xs" onClick={() => startEditQuestion(q)}>수정</button>
                        )}
                        {isAuthor && (
                          <button className="btn btn-secondary text-xs" onClick={() => deleteQuestion(q)}>삭제</button>
                        )}
                      </div>
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
                  </>
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
                <div key={p.user_id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{dir.displayName(p.user_id)}</span>
                  <select
                    className="input w-28 flex-shrink-0 text-xs"
                    value={p.role}
                    disabled={participantSaving === p.user_id}
                    onChange={(e) => changeParticipantRole(p, e.target.value as "AUTHOR" | "PARTICIPANT" | "VIEWER")}
                  >
                    <option value="AUTHOR">편집자</option>
                    <option value="PARTICIPANT">참여자</option>
                    <option value="VIEWER">열람자</option>
                  </select>
                  <button
                    className="btn btn-secondary flex-shrink-0 text-xs"
                    disabled={participantSaving === p.user_id}
                    onClick={() => removeParticipant(p)}
                  >
                    삭제
                  </button>
                </div>
              ))}
              {participants.length === 0 && <p className="text-sm text-gray-400">지정된 참여자가 없습니다.</p>}
            </div>
            <div className="flex gap-2">
              <select className="input" value={newParticipantUid} onChange={(e) => setNewParticipantUid(e.target.value)}>
                <option value="">참여자로 지정할 사용자 선택</option>
                {orgUserOptions.map((u) => (
                  <option key={u.id} value={u.id}>{u.user_name}</option>
                ))}
              </select>
              <select
                className="input w-28 flex-shrink-0"
                value={newParticipantRole}
                onChange={(e) => setNewParticipantRole(e.target.value as "AUTHOR" | "PARTICIPANT" | "VIEWER")}
              >
                <option value="AUTHOR">편집자</option>
                <option value="PARTICIPANT">참여자</option>
                <option value="VIEWER">열람자</option>
              </select>
              <button className="btn btn-secondary flex-shrink-0 text-xs" onClick={addParticipant} disabled={!newParticipantUid}>참여자 추가</button>
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
