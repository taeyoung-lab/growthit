"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { authedFetch } from "@/lib/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import { useDirectory } from "@/lib/firestore/useDirectory";
import { QUESTION_STATUS_LABEL, ACTION_ITEM_STATUS_LABEL } from "@/lib/statusLabels";
import type { Answer, ActionItem, Decision, Meeting, MeetingShare, MeetingSummary, Question } from "@/lib/types";

const DECISION_STATUS_LABEL_KO: Record<string, string> = { ACTIVE: "유효", SUPERSEDED: "변경됨", CANCELLED: "취소됨" };

/** HTML 다운로드용 — 사용자가 입력한 문자열을 그대로 태그에 꽂으면 깨지거나 스크립트가
 * 실행될 수 있으므로 반드시 이스케이프합니다. */
function escapeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 회의록 1건을 완전히 독립적인(외부 CSS/스크립트 의존 없는) HTML 문서 문자열로 만듭니다.
 * 공유 링크 화면(/share/[token]/view)과 같은 구성(1~5장 + 결정사항)을 그대로 따르되,
 * 다운로드한 사람이 인터넷 연결이나 로그인 없이도 파일만으로 그대로 열어볼 수 있어야 하므로
 * Tailwind 클래스 대신 인라인 <style>로 최소한의 모양만 재현합니다. */
function buildMeetingHtmlDocument(data: {
  meeting: Meeting;
  summary: MeetingSummary | null;
  actionItems: ActionItem[];
  questions: Question[];
  answersByQuestion: Record<string, Answer[]>;
  decisions: Decision[];
  displayName: (userId: string | null | undefined) => string;
}): string {
  const { meeting, summary, actionItems, questions, answersByQuestion, decisions, displayName } = data;
  const esc = escapeHtml;

  const attendeesBlock = (title: string, people: { name: string; title: string }[]) => `
    <div>
      <p class="label">참석자 — ${esc(title)}</p>
      ${
        people.length > 0
          ? `<ul>${people.map((p) => `<li>${esc(p.name)}${p.title ? ` (${esc(p.title)})` : ""}</li>`).join("")}</ul>`
          : `<p class="muted">참석자 없음</p>`
      }
    </div>`;

  const topicsBlock =
    summary && summary.topics.length > 0
      ? summary.topics.map((t) => `<div class="topic"><p class="topic-title">${esc(t.title)}</p><p class="pre">${esc(t.content)}</p></div>`).join("")
      : `<p class="muted">등록된 논의내용이 없습니다.</p>`;

  const actionItemsBlock =
    actionItems.length > 0
      ? actionItems
          .map(
            (a) => `
      <div class="row-card">
        <div class="row-main">
          <p class="row-title">${esc(a.title)}</p>
          <p class="row-meta">담당 ${esc(a.assignee_user_ids.map((id) => displayName(id)).join(", ") || "미지정")} · 기한 ${esc(a.due_date || "없음")}${a.description ? ` · ${esc(a.description)}` : ""}</p>
        </div>
        <span class="badge">${esc(ACTION_ITEM_STATUS_LABEL[a.status] || a.status)}</span>
      </div>`
          )
          .join("")
      : `<p class="muted">등록된 향후추진과제가 없습니다.</p>`;

  const decisionsBlock =
    decisions.length > 0
      ? decisions
          .map(
            (d) => `
      <div class="card-inner">
        <div class="row-main" style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <p class="row-title">${esc(d.decision_title)} <span class="version">v${d.version}</span></p>
            <p class="pre" style="color:#4b5563;">${esc(d.decision_content)}</p>
          </div>
          <span class="badge">${esc(DECISION_STATUS_LABEL_KO[d.decision_status] || d.decision_status)}</span>
        </div>
      </div>`
          )
          .join("")
      : `<p class="muted">등록된 결정사항이 없습니다.</p>`;

  const qnaBlock =
    questions.length > 0
      ? questions
          .map((q) => {
            const answers = answersByQuestion[q.id] || [];
            return `
      <div class="card-inner">
        <span class="badge">${esc(QUESTION_STATUS_LABEL[q.question_status] || q.question_status)}</span>
        <p class="q-content">${esc(q.question_content)}</p>
        <div class="row-meta" style="display:flex; gap:16px;">
          <span>질문자 ${esc(displayName(q.questioner_user_id))}</span>
          <span>담당 ${esc(displayName(q.assignee_user_id))}</span>
        </div>
        ${answers
          .map(
            (ans) => `
        <div class="answer">
          <p style="margin:0;">${esc(ans.answer_content)}</p>
          <p class="row-meta" style="margin-top:4px;">답변자 ${esc(displayName(ans.answerer_user_id))}</p>
        </div>`
          )
          .join("")}
      </div>`;
          })
          .join("")
      : `<p class="muted">등록된 문답이 없습니다.</p>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(meeting.meeting_title)} — 회의록</title>
<style>
  body { font-family: "Noto Sans KR", "Malgun Gothic", system-ui, -apple-system, sans-serif; background:#f5f6fa; color:#1b2340; margin:0; padding:0; }
  header { background:#fff; border-bottom:1px solid #e5e7eb; padding:24px 32px; }
  header .tag { color:#2fc2ac; font-size:12px; font-weight:600; margin:0 0 4px; }
  header h1 { font-size:20px; margin:0 0 4px; color:#1b2340; }
  header .meta { color:#9ca3af; font-size:13px; margin:0; }
  main { max-width:760px; margin:0 auto; padding:32px 24px; }
  section.card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:24px; margin-bottom:24px; box-shadow:0 1px 2px rgba(0,0,0,0.03); }
  section.card h2 { font-size:15px; margin:0 0 12px; color:#1b2340; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:24px; font-size:14px; }
  .label { font-weight:500; color:#6b7280; margin:0 0 4px; }
  .muted { color:#9ca3af; font-size:14px; }
  ul { margin:0; padding-left:18px; }
  .pre { white-space:pre-line; font-size:14px; line-height:1.6; }
  .topic { margin-bottom:12px; }
  .topic-title { font-weight:600; color:#1b2340; font-size:14px; margin:0 0 2px; }
  .row-card { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; border:1px solid #e5e7eb; border-radius:10px; padding:12px; font-size:14px; margin-bottom:8px; }
  .row-main { min-width:0; flex:1; }
  .row-title { font-weight:500; margin:0; color:#1b2340; }
  .row-meta { color:#9ca3af; font-size:12px; margin:4px 0 0; }
  .badge { flex-shrink:0; display:inline-flex; align-items:center; border-radius:9999px; padding:2px 10px; font-size:12px; font-weight:500; background:#dbeafe; color:#1e40af; white-space:nowrap; }
  .card-inner { border:1px solid #e5e7eb; border-radius:10px; padding:16px; margin-bottom:12px; }
  .version { font-size:12px; color:#9ca3af; font-weight:400; }
  .q-content { font-size:14px; margin:8px 0; color:#1b2340; }
  .answer { background:#f9fafb; border-radius:10px; padding:12px; font-size:14px; margin-top:8px; }
  footer { text-align:center; color:#9ca3af; font-size:12px; padding:24px; }
</style>
</head>
<body>
<header>
  <p class="tag">그로스잇 회의록 — 오프라인 저장본 (다운로드 시점 스냅샷)</p>
  <h1>${esc(meeting.meeting_title)}</h1>
  <p class="meta">${esc(meeting.meeting_date)}${meeting.meeting_start_time ? ` · ${esc(meeting.meeting_start_time)}` : ""} · ${esc(meeting.location || "장소 미기재")}</p>
</header>
<main>
  <section class="card">
    <h2>1. 개요</h2>
    <div class="grid2">
      ${attendeesBlock(meeting.attendees.client_company_name || "고객사", meeting.attendees.client_attendees)}
      ${attendeesBlock("와일리", meeting.attendees.wylie_attendees)}
    </div>
  </section>

  <section class="card">
    <h2>2. 회의 요약</h2>
    <p class="pre">${esc(summary?.summary_text) || "요약이 입력되지 않았습니다."}</p>
  </section>

  <section class="card">
    <h2>3. 논의내용</h2>
    ${topicsBlock}
  </section>

  <section class="card">
    <h2>4. 향후추진과제</h2>
    ${actionItemsBlock}
  </section>

  <section class="card">
    <h2>결정사항</h2>
    ${decisionsBlock}
  </section>

  <section class="card">
    <h2>5. 문답 (Q&amp;A)</h2>
    ${qnaBlock}
  </section>

  <footer>이 파일은 ${esc(new Date().toLocaleString("ko-KR"))}에 다운로드된 스냅샷입니다 — 이후 시스템에서 내용이 변경되어도 이 파일은 갱신되지 않습니다.</footer>
</main>
</body>
</html>`;
}

function ShareContent({ meetingId }: { meetingId: string }) {
  const { profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);
  const [shares, setShares] = useState<MeetingShare[]>([]);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"VIEWER" | "PARTICIPANT">("VIEWER");
  const [result, setResult] = useState<{ share_url: string; temporary_password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function loadShares() {
    const snap = await getDocs(collection(db, "meetings", meetingId, "shares"));
    setShares(snap.docs.map((d) => d.data() as MeetingShare));
  }

  useEffect(() => {
    loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // 회의록을 다른 시스템 접속 없이도 볼 수 있도록, 지금 이 회의의 내용을 하나의 독립적인
  // HTML 파일로 내보냅니다(이메일 첨부 등으로 바로 전달 가능). 공유 링크(계정 기반)와는
  // 별개의, 오프라인 스냅샷 저장 기능입니다.
  async function handleDownloadHtml() {
    setDownloading(true);
    setError(null);
    try {
      const [meetingSnap, summarySnap, actionItemsSnap, questionsSnap, decisionsSnap] = await Promise.all([
        getDoc(doc(db, "meetings", meetingId)),
        getDoc(doc(db, "meetingSummaries", meetingId)),
        getDocs(query(collection(db, "actionItems"), where("meeting_id", "==", meetingId))),
        getDocs(query(collection(db, "questions"), where("meeting_id", "==", meetingId), orderBy("created_at", "asc"))),
        getDocs(query(collection(db, "decisions"), where("meeting_id", "==", meetingId))),
      ]);
      if (!meetingSnap.exists()) throw new Error("회의록을 찾을 수 없습니다.");
      const meeting = meetingSnap.data() as Meeting;
      const summary = summarySnap.exists() ? (summarySnap.data() as MeetingSummary) : null;
      const actionItems = actionItemsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ActionItem));
      const questions = questionsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Question));
      const decisions = decisionsSnap.docs.map((d) => d.data() as Decision);

      const answersByQuestion = Object.fromEntries(
        await Promise.all(
          questions.map(async (q) => {
            const ansSnap = await getDocs(query(collection(db, "questions", q.id, "answers"), orderBy("answered_at", "asc")));
            return [q.id, ansSnap.docs.map((d) => d.data() as Answer)] as const;
          })
        )
      );

      const html = buildMeetingHtmlDocument({ meeting, summary, actionItems, questions, answersByQuestion, decisions, displayName: dir.displayName });
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const fileNameSafe = `${meeting.meeting_title}_${meeting.meeting_date}`.replace(/[\\/:*?"<>|]/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileNameSafe}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "HTML 다운로드에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await authedFetch("/api/share/create", {
        method: "POST",
        body: JSON.stringify({ meeting_id: meetingId, target_email: email, permission }),
      });
      setResult(res);
      setEmail("");
      loadShares();
    } catch (e) {
      setError(e instanceof Error ? e.message : "공유 링크 생성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold text-navy">공유 관리</h1>

        <form onSubmit={handleShare} className="card mb-6 flex flex-col gap-3 p-5">
          <p className="text-sm text-gray-500">
            공유 대상은 반드시 등록된 사용자여야 합니다(23장). 등록되지 않은 이메일이면 먼저 관리자에게
            사용자 등록을 요청하세요.
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              required
              placeholder="공유 대상 이메일"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select className="input w-40" value={permission} onChange={(e) => setPermission(e.target.value as any)}>
              <option value="VIEWER">열람자 (읽기 전용)</option>
              <option value="PARTICIPANT">참여자 (편집 가능)</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button className="btn btn-primary self-start" disabled={submitting}>
              {submitting ? "생성 중…" : "공유 링크 생성"}
            </button>
            <button type="button" className="btn btn-secondary self-start" disabled={downloading} onClick={handleDownloadHtml}>
              {downloading ? "다운로드 준비 중…" : "HTML로 다운로드"}
            </button>
          </div>
        </form>

        {result && (
          <div className="card mb-6 border-mint p-5">
            <p className="mb-2 text-sm font-medium text-ink">
              생성 완료 — 아래 정보를 대상자에게 별도 채널(메신저 등)로 직접 전달하세요. 다시 확인할 수 없습니다.
            </p>
            <p className="text-sm">
              공유 URL: <code className="rounded bg-gray-100 px-1">{result.share_url}</code>
            </p>
            <p className="text-sm">
              임시 비밀번호: <code className="rounded bg-gray-100 px-1">{result.temporary_password}</code>
            </p>
          </div>
        )}

        <h2 className="mb-3 font-semibold text-ink">공유 목록</h2>
        <div className="flex flex-col gap-2">
          {shares.map((s) => (
            <div key={s.id} className="card flex items-center justify-between p-4 text-sm">
              <span>{dir.displayName(s.user_id)}</span>
              <span className="text-gray-400">{s.permission}</span>
              <span className={s.share_status === "ACTIVE" ? "text-emerald-600" : "text-gray-400"}>{s.share_status}</span>
            </div>
          ))}
          {shares.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">공유 이력이 없습니다.</p>}
        </div>
      </main>
    </div>
  );
}

export default function SharePage({ params }: { params: { id: string } }) {
  return (
    <AuthGate>
      <ShareContent meetingId={params.id} />
    </AuthGate>
  );
}
