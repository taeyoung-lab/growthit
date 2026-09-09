
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// 공유 링크 전용 읽기 화면. 의도적으로 <Navbar />를 포함하지 않고, 다른 페이지로 가는 링크도
// 전혀 넣지 않습니다 — 링크를 받은 사람이 볼 수 있는 유일한 화면입니다. Firebase 로그인도
// 하지 않으므로, 이 화면을 벗어나 앱의 다른 URL로 직접 이동해도 로그인이 안 되어 있어
// 아무 것도 볼 수 없습니다.

type ShareSession = { proof: string; meeting_id: string; permission: "VIEWER" | "PARTICIPANT" };

type Content = {
  permission: "VIEWER" | "PARTICIPANT";
  meeting: {
    title: string;
    date: string;
    start_time: string | null;
    location: string | null;
    client_company_name: string | null;
    client_attendees: { name: string; title?: string }[];
    wylie_attendees: { name: string; title?: string }[];
  };
  summary: { summary_text: string | null; topics: { title: string; content: string }[] };
  action_items: { id: string; title: string; description: string | null; due_date: string | null; status: string; assignees: string[] }[];
  qna: {
    id: string;
    question_content: string;
    question_status: string;
    questioner_name: string;
    assignee_name: string;
    answers: { answer_content: string; answerer_name: string }[];
  }[];
};

const ACTION_STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "시작 전",
  IN_PROGRESS: "진행중",
  DONE: "완료",
  ON_HOLD: "보류",
};

const QUESTION_STATUS_LABEL: Record<string, string> = {
  ANSWER_PENDING: "답변대기",
  ANSWERED: "답변완료",
  CONFIRM_NEEDED: "확인필요",
  CLOSED: "종료",
};

export default function ShareViewPage({ params }: { params: { token: string } }) {
  const [session, setSession] = useState<ShareSession | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newQuestion, setNewQuestion] = useState("");
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem(`share:${params.token}`);
    if (!raw) {
      setError("NO_SESSION");
      setLoading(false);
      return;
    }
    setSession(JSON.parse(raw));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token]);

  async function load(proof: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/share/${params.token}/content?proof=${encodeURIComponent(proof)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "불러오기에 실패했습니다.");
      setContent(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) load(session.proof);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function submitQuestion() {
    if (!session || !newQuestion.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/share/${params.token}/qna`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: session.proof, action: "question", question_content: newQuestion.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "질문 등록에 실패했습니다.");
      setNewQuestion("");
      await load(session.proof);
    } catch (e) {
      alert(e instanceof Error ? e.message : "질문 등록에 실패했습니다.");
    } finally {
      setPosting(false);
    }
  }

  async function submitAnswer(questionId: string) {
    if (!session) return;
    const content = replyDraft[questionId]?.trim();
    if (!content) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/share/${params.token}/qna`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: session.proof, action: "answer", question_id: questionId, answer_content: content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "답변 등록에 실패했습니다.");
      setReplyDraft((prev) => ({ ...prev, [questionId]: "" }));
      await load(session.proof);
    } catch (e) {
      alert(e instanceof Error ? e.message : "답변 등록에 실패했습니다.");
    } finally {
      setPosting(false);
    }
  }

  if (error === "NO_SESSION") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-4">
        <div className="w-full max-w-sm card p-8 text-center">
          <p className="mb-4 text-sm text-gray-500">먼저 이메일과 임시 비밀번호로 접속 인증이 필요합니다.</p>
          <Link href={`/share/${params.token}`} className="btn btn-primary inline-block">접속 화면으로 이동</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return <p className="p-8 text-center text-sm text-gray-400">불러오는 중…</p>;
  }

  if (error || !content) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-4">
        <div className="w-full max-w-sm card p-8 text-center">
          <p className="mb-4 text-sm text-red-600">{error || "회의록을 불러올 수 없습니다."}</p>
          <Link href={`/share/${params.token}`} className="btn btn-secondary inline-block">다시 접속</Link>
        </div>
      </div>
    );
  }

  const m = content.meeting;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-xs font-medium text-mint">공유된 회의록 (읽기 전용 · {content.permission === "PARTICIPANT" ? "참여자" : "열람자"})</p>
        <h1 className="text-lg font-bold text-navy">{m.title}</h1>
        <p className="text-xs text-gray-400">{m.date} {m.start_time ? `· ${m.start_time}` : ""} · {m.location || "장소 미기재"}</p>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">1. 개요</h2>
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="mb-1 font-medium text-gray-500">참석자 — {m.client_company_name || "고객사"}</p>
              {m.client_attendees.length > 0 ? (
                <ul className="text-ink">{m.client_attendees.map((a, i) => <li key={i}>{a.name} {a.title && `(${a.title})`}</li>)}</ul>
              ) : <p className="text-gray-400">참석자 없음</p>}
            </div>
            <div>
              <p className="mb-1 font-medium text-gray-500">참석자 — 와일리</p>
              {m.wylie_attendees.length > 0 ? (
                <ul className="text-ink">{m.wylie_attendees.map((a, i) => <li key={i}>{a.name} {a.title && `(${a.title})`}</li>)}</ul>
              ) : <p className="text-gray-400">참석자 없음</p>}
            </div>
          </div>
        </section>

        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">2. 회의 요약</h2>
          <p className="whitespace-pre-line text-sm text-ink">{content.summary.summary_text || "요약이 입력되지 않았습니다."}</p>
        </section>

        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">3. 논의내용</h2>
          {content.summary.topics.length > 0 ? (
            content.summary.topics.map((t, i) => (
              <div key={i} className="mb-3">
                <p className="text-sm font-semibold text-navy">{t.title}</p>
                <p className="whitespace-pre-line text-sm text-gray-600">{t.content}</p>
              </div>
            ))
          ) : <p className="text-sm text-gray-400">등록된 논의내용이 없습니다.</p>}
        </section>

        <section className="card mb-6 p-6">
          <h2 className="mb-3 font-semibold text-ink">4. 향후추진과제</h2>
          <div className="flex flex-col gap-2">
            {content.action_items.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{a.title}</p>
                  <p className="text-xs text-gray-400">
                    담당 {a.assignees.join(", ") || "미지정"} · 기한 {a.due_date || "없음"}{a.description && ` · ${a.description}`}
                  </p>
                </div>
                <span className="badge badge-progress">{ACTION_STATUS_LABEL[a.status] || a.status}</span>
              </div>
            ))}
            {content.action_items.length === 0 && <p className="text-sm text-gray-400">등록된 향후추진과제가 없습니다.</p>}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="mb-3 font-semibold text-ink">5. 문답 (Q&A)</h2>
          <div className="flex flex-col gap-4">
            {content.qna.map((q) => (
              <div key={q.id} className="rounded-lg border border-gray-200 p-4">
                <span className="badge badge-progress">{QUESTION_STATUS_LABEL[q.question_status] || q.question_status}</span>
                <p className="mt-2 text-sm text-ink">{q.question_content}</p>
                <div className="mt-1 flex gap-4 text-xs text-gray-400">
                  <span>질문자 {q.questioner_name}</span>
                  <span>담당 {q.assignee_name}</span>
                </div>
                {q.answers.map((ans, i) => (
                  <div key={i} className="mt-2 rounded-lg bg-gray-50 p-3 text-sm">
                    <p className="text-ink">{ans.answer_content}</p>
                    <p className="mt-1 text-xs text-gray-400">답변자 {ans.answerer_name}</p>
                  </div>
                ))}
                {content.permission === "PARTICIPANT" && q.question_status !== "CLOSED" && (
                  <div className="mt-2 flex gap-2">
                    <input
                      className="input flex-1 text-xs"
                      placeholder="답변 입력"
                      value={replyDraft[q.id] || ""}
                      onChange={(e) => setReplyDraft((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    />
                    <button className="btn btn-secondary text-xs" disabled={posting} onClick={() => submitAnswer(q.id)}>답변 등록</button>
                  </div>
                )}
              </div>
            ))}
            {content.qna.length === 0 && <p className="text-sm text-gray-400">등록된 문답이 없습니다.</p>}

            {content.permission === "PARTICIPANT" && (
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="mb-2 text-sm font-medium text-ink">새 질문 등록</p>
                <textarea
                  className="input mb-2 w-full text-sm"
                  placeholder="질문 내용을 입력하세요."
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                />
                <button className="btn btn-primary text-xs" disabled={posting || !newQuestion.trim()} onClick={submitQuestion}>등록</button>
              </div>
            )}
          </div>
        </section>

        <p className="mt-6 text-center text-xs text-gray-400">이 화면은 공유받은 회의록 전용 화면입니다. 그로스잇 회의록시스템의 다른 화면은 볼 수 없습니다.</p>
      </main>
    </div>
  );
}
