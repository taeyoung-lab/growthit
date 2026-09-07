"use client";

import { useEffect, useState, useCallback } from "react";
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
  Decision,
  Meeting,
  MeetingSummary,
  Question,
  QuestionStatus,
  TranscriptSegment,
} from "@/lib/types";

type Tab = "summary" | "questions" | "decisions" | "actions" | "transcript";

interface EnrichedAnalysis {
  summary: string;
  topics: { title: string; content: string }[];
  questions: Array<{
    content: string;
    questioner_name: string | null;
    assignee_name: string | null;
    due_date: string | null;
    source_segment_order: number | null;
    matched_questioner_id: string | null;
    matched_assignee_id: string | null;
  }>;
  decisions: Array<{ title: string; content: string; source_segment_order: number | null }>;
  action_items: Array<{
    title: string;
    description: string;
    assignee_names: string[];
    due_date: string | null;
    source_segment_order: number | null;
    matched_assignee_ids: string[];
  }>;
}

interface LinkSuggestion {
  question_id: string;
  matched_segment_order: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
  suggested_answer_content: string;
}

function MeetingDetailContent({ meetingId }: { meetingId: string }) {
  const { firebaseUser, profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [tab, setTab] = useState<Tab>("transcript");

  const [pasteText, setPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<EnrichedAnalysis | null>(null);

  const [linkSuggestions, setLinkSuggestions] = useState<LinkSuggestion[]>([]);
  const [linkQuestionContent, setLinkQuestionContent] = useState<Record<string, string>>({});
  const [suggestingLinks, setSuggestingLinks] = useState(false);

  const canEdit = myRole === "AUTHOR" || myRole === "PARTICIPANT";
  const isAuthor = myRole === "AUTHOR";

  const loadAll = useCallback(async () => {
    if (!firebaseUser) return;
    const mSnap = await getDoc(doc(db, "meetings", meetingId));
    if (!mSnap.exists()) return;
    setMeeting(mSnap.data() as Meeting);

    const permSnap = await getDoc(doc(db, "meetings", meetingId, "permissions", firebaseUser.uid));
    setMyRole(permSnap.exists() ? (permSnap.data().role as string) : null);

    const segSnap = await getDocs(
      query(collection(db, "transcripts", meetingId, "segments"), orderBy("order", "asc"))
    );
    setSegments(segSnap.docs.map((d) => d.data() as TranscriptSegment));

    const summarySnap = await getDoc(doc(db, "meetingSummaries", meetingId));
    setSummary(summarySnap.exists() ? (summarySnap.data() as MeetingSummary) : null);

    const [qSnap, dSnap, aSnap] = await Promise.all([
      getDocs(query(collection(db, "questions"), where("meeting_id", "==", meetingId))),
      getDocs(query(collection(db, "decisions"), where("meeting_id", "==", meetingId))),
      getDocs(query(collection(db, "actionItems"), where("meeting_id", "==", meetingId))),
    ]);
    setQuestions(qSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Question)));
    setDecisions(dSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Decision)));
    setActionItems(aSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ActionItem)));
  }, [firebaseUser, meetingId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ---- 텍스트 회의록 저장 (오디오/STT 대신 "이름: 내용" 줄 단위 입력) ----
  async function saveTranscript() {
    if (!pasteText.trim()) return;
    setSaving(true);
    const lines = pasteText.split("\n").map((l) => l.trim()).filter(Boolean);

    const existing = await getDocs(collection(db, "transcripts", meetingId, "segments"));
    await Promise.all(existing.docs.map((d) => deleteDoc(d.ref)));

    let order = 0;
    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      const speakerRaw = colonIdx > -1 ? line.slice(0, colonIdx).trim() : "화자미상";
      const content = colonIdx > -1 ? line.slice(colonIdx + 1).trim() : line;
      const matchedUser = Object.values(dir.users).find((u) => u.user_name === speakerRaw);
      const segRef = doc(collection(db, "transcripts", meetingId, "segments"));
      await setDoc(segRef, {
        id: segRef.id,
        meeting_id: meetingId,
        order: order++,
        speaker_user_id: matchedUser?.id || null,
        speaker_name_raw: speakerRaw,
        content,
        created_at: Date.now(),
      });
    }

    await updateDoc(doc(db, "transcripts", meetingId), {
      raw_text: pasteText,
      transcript_status: "SUBMITTED",
      updated_at: Date.now(),
    });

    setPasteText("");
    setSaving(false);
    loadAll();
  }

  async function runAnalysis() {
    setAnalyzing(true);
    try {
      const result = await authedFetch(`/api/meetings/${meetingId}/analyze`, { method: "POST" });
      setAnalysis(result);
      setTab("questions");
    } catch (e) {
      alert(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveAllAnalysis() {
    if (!analysis || !firebaseUser || !meeting) return;
    const now = Date.now();

    for (const q of analysis.questions) {
      const ref = doc(collection(db, "questions"));
      await setDoc(ref, {
        id: ref.id,
        meeting_id: meetingId,
        project_id: meeting.project_id,
        organization_id: meeting.organization_id,
        questioner_user_id: q.matched_questioner_id || firebaseUser.uid,
        assignee_user_id: q.matched_assignee_id,
        question_content: q.content,
        question_status: "ANSWER_PENDING",
        due_date: q.due_date,
        source_segment_id: null,
        created_at: now,
        updated_at: now,
      });
    }

    for (const d of analysis.decisions) {
      const ref = doc(collection(db, "decisions"));
      await setDoc(ref, {
        id: ref.id,
        meeting_id: meetingId,
        project_id: meeting.project_id,
        organization_id: meeting.organization_id,
        decision_title: d.title,
        decision_content: d.content,
        decision_status: "ACTIVE",
        source_segment_id: null,
        version: 1,
        created_at: now,
        updated_at: now,
      });
    }

    for (const a of analysis.action_items) {
      const ref = doc(collection(db, "actionItems"));
      await setDoc(ref, {
        id: ref.id,
        meeting_id: meetingId,
        project_id: meeting.project_id,
        organization_id: meeting.organization_id,
        title: a.title,
        description: a.description,
        status: "TODO",
        due_date: a.due_date,
        created_by_user_id: firebaseUser.uid,
        assignee_user_ids: a.matched_assignee_ids,
        source_segment_id: null,
        created_at: now,
        updated_at: now,
      });
    }

    setAnalysis(null);
    loadAll();
  }

  async function runLinkSuggestions() {
    if (!meeting) return;
    setSuggestingLinks(true);
    try {
      const result = await authedFetch(`/api/meetings/${meetingId}/link-suggestions`, { method: "POST" });
      setLinkSuggestions(result.suggestions);
      const ids = result.suggestions.map((s: LinkSuggestion) => s.question_id);
      const contentMap: Record<string, string> = {};
      for (const id of ids) {
        const snap = await getDoc(doc(db, "questions", id));
        if (snap.exists()) contentMap[id] = snap.data().question_content;
      }
      setLinkQuestionContent(contentMap);
    } catch (e) {
      alert(e instanceof Error ? e.message : "연결 제안 생성 실패");
    } finally {
      setSuggestingLinks(false);
    }
  }

  async function confirmLink(s: LinkSuggestion) {
    if (!firebaseUser) return;
    const now = Date.now();
    await addDoc(collection(db, "questions", s.question_id, "answers"), {
      question_id: s.question_id,
      answerer_user_id: firebaseUser.uid,
      answer_content: s.suggested_answer_content,
      source_type: "FOLLOW_UP_MEETING",
      source_meeting_id: meetingId,
      source_segment_id: null,
      answered_at: now,
      created_at: now,
      updated_at: now,
    });
    await updateDoc(doc(db, "questions", s.question_id), { question_status: "ANSWERED", updated_at: now });
    setLinkSuggestions((prev) => prev.filter((x) => x.question_id !== s.question_id));
  }

  async function updateQuestionStatus(q: Question, status: QuestionStatus) {
    await updateDoc(doc(db, "questions", q.id), { question_status: status, updated_at: Date.now() });
    loadAll();
  }

  if (!meeting) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <p className="p-8 text-center text-sm text-gray-400">불러오는 중이거나 접근 권한이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-navy">{meeting.meeting_title}</h1>
            <p className="text-sm text-gray-400">
              {meeting.meeting_date} · {dir.organizations[meeting.organization_id]?.organization_name} · 내 권한: {myRole || "없음"}
            </p>
          </div>
          {isAuthor && (
            <Link href={`/meetings/${meetingId}/share`} className="btn btn-secondary text-xs">
              공유 관리
            </Link>
          )}
        </div>

        <div className="mb-4 flex gap-1 border-b border-gray-200">
          {([
            ["transcript", "회의록 입력/원문"],
            ["summary", "요약"],
            ["questions", `질의 (${questions.length})`],
            ["decisions", `결정사항 (${decisions.length})`],
            ["actions", `액션아이템 (${actionItems.length})`],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium ${
                tab === key ? "border-b-2 border-navy text-navy" : "text-gray-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "transcript" && (
          <div className="flex flex-col gap-4">
            {canEdit && (
              <div className="card p-5">
                <p className="mb-2 text-sm font-medium text-ink">회의록 텍스트 입력</p>
                <p className="mb-3 text-xs text-gray-400">
                  한 줄에 하나씩, <code>이름: 발언 내용</code> 형식으로 입력하세요. 저장하면 기존 원문을 대체합니다.
                </p>
                <textarea
                  className="input h-48 font-mono text-xs"
                  placeholder={"박태영: POS 연동 일정은 언제 확정되나요?\n김민수: 9월 15일까지 확인해보겠습니다."}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <div className="mt-3 flex gap-2">
                  <button className="btn btn-primary" onClick={saveTranscript} disabled={saving || !pasteText.trim()}>
                    {saving ? "저장 중…" : "저장"}
                  </button>
                  {segments.length > 0 && (
                    <button className="btn btn-accent" onClick={runAnalysis} disabled={analyzing}>
                      {analyzing ? "분석 중…" : "AI 분석 실행"}
                    </button>
                  )}
                  {segments.length > 0 && (
                    <button className="btn btn-secondary" onClick={runLinkSuggestions} disabled={suggestingLinks}>
                      {suggestingLinks ? "확인 중…" : "이전 미결사항 연결 제안 보기"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {linkSuggestions.length > 0 && (
              <div className="card p-5">
                <p className="mb-3 text-sm font-medium text-ink">연결 제안 (19장) — 확인 후 승인하세요</p>
                {linkSuggestions.map((s) => (
                  <div key={s.question_id} className="mb-3 rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-400">기존 질의: {linkQuestionContent[s.question_id]}</p>
                    <p className="mt-1 text-sm text-ink">제안 답변: {s.suggested_answer_content}</p>
                    <p className="mt-1 text-xs text-gray-400">신뢰도 {s.confidence} · {s.reasoning}</p>
                    <button className="btn btn-accent mt-2 text-xs" onClick={() => confirmLink(s)}>
                      답변으로 연결
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="card p-5">
              <p className="mb-3 text-sm font-medium text-ink">원문 ({segments.length}개 발언)</p>
              <div className="flex flex-col gap-2 text-sm">
                {segments.map((s) => (
                  <div key={s.id} className="flex gap-2">
                    <span className="w-8 shrink-0 font-mono text-xs text-gray-300">{s.order}</span>
                    <span className="w-28 shrink-0 font-medium text-navy">{s.speaker_name_raw}</span>
                    <span className="text-ink">{s.content}</span>
                  </div>
                ))}
                {segments.length === 0 && <p className="text-sm text-gray-400">아직 입력된 회의록이 없습니다.</p>}
              </div>
            </div>
          </div>
        )}

        {tab === "summary" && (
          <div className="card p-5">
            {summary ? (
              <>
                <p className="mb-4 text-sm leading-relaxed text-ink">{summary.summary_text}</p>
                {summary.topics.map((t, i) => (
                  <div key={i} className="mb-3">
                    <p className="text-sm font-semibold text-navy">{t.title}</p>
                    <p className="text-sm text-gray-600">{t.content}</p>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm text-gray-400">아직 요약이 없습니다. 회의록 입력 후 AI 분석을 실행하세요.</p>
            )}
          </div>
        )}

        {tab === "questions" && (
          <div className="flex flex-col gap-4">
            {analysis && analysis.questions.length > 0 && (
              <div className="card border-mint p-5">
                <p className="mb-3 text-sm font-medium text-ink">AI 분석 결과 — 확인 후 저장하세요</p>
                <ul className="mb-3 flex flex-col gap-2 text-sm">
                  {analysis.questions.map((q, i) => (
                    <li key={i} className="rounded-lg bg-gray-50 p-3">
                      <p>{q.content}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        질문자: {q.questioner_name || "미상"} {q.matched_questioner_id ? "✓매칭" : "(매칭 안 됨)"} · 담당:{" "}
                        {q.assignee_name || "미지정"} {q.matched_assignee_id ? "✓매칭" : q.assignee_name ? "(매칭 안 됨 - 저장 후 지정)" : ""}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={saveAllAnalysis}>
                    전체 저장 (질의·결정·액션아이템)
                  </button>
                  <button className="btn btn-secondary" onClick={() => setAnalysis(null)}>
                    취소
                  </button>
                </div>
              </div>
            )}

            {questions.map((q) => (
              <div key={q.id} className="card p-4">
                <div className="flex items-start justify-between">
                  <span className={`badge ${QUESTION_STATUS_BADGE[q.question_status]}`}>
                    {QUESTION_STATUS_LABEL[q.question_status]}
                  </span>
                  {canEdit && (
                    <select
                      className="rounded border border-gray-200 text-xs"
                      value={q.question_status}
                      onChange={(e) => updateQuestionStatus(q, e.target.value as QuestionStatus)}
                    >
                      {Object.entries(QUESTION_STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="mt-2 text-sm text-ink">{q.question_content}</p>
                <div className="mt-2 flex gap-4 text-xs text-gray-400">
                  <span>질문자 {dir.displayName(q.questioner_user_id)}</span>
                  <span>담당 {dir.displayName(q.assignee_user_id)}</span>
                  <span>기한 {q.due_date || "없음"}</span>
                </div>
              </div>
            ))}
            {questions.length === 0 && !analysis && <p className="card p-6 text-center text-sm text-gray-400">등록된 질의가 없습니다.</p>}
          </div>
        )}

        {tab === "decisions" && (
          <div className="flex flex-col gap-4">
            {decisions.map((d) => (
              <div key={d.id} className="card p-4">
                <p className="font-medium text-navy">{d.decision_title}</p>
                <p className="mt-1 text-sm text-ink">{d.decision_content}</p>
                <p className="mt-2 text-xs text-gray-400">버전 {d.version}</p>
              </div>
            ))}
            {decisions.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">등록된 결정사항이 없습니다.</p>}
          </div>
        )}

        {tab === "actions" && (
          <div className="flex flex-col gap-4">
            {actionItems.map((a) => (
              <div key={a.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink">{a.title}</p>
                  <span className="badge badge-progress">{ACTION_ITEM_STATUS_LABEL[a.status]}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{a.description}</p>
                <p className="mt-2 text-xs text-gray-400">
                  담당 {a.assignee_user_ids.map((id) => dir.displayName(id)).join(", ") || "미지정"} · 기한 {a.due_date || "없음"}
                </p>
              </div>
            ))}
            {actionItems.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">등록된 액션아이템이 없습니다.</p>}
          </div>
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
