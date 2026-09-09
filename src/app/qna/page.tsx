
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { useDirectory } from "@/lib/firestore/useDirectory";
import { QUESTION_STATUS_LABEL, QUESTION_STATUS_BADGE } from "@/lib/statusLabels";
import type { Answer, Project, Question, QuestionStatus } from "@/lib/types";

// Q&A 관리 — 화면설계 목업의 신규 화면. 프로젝트 하나에 갇히지 않고, 조직 전체의 미해결
// 질의를 한 곳에서 추적합니다. 접근 범위: 회의 단위 권한이 아니라 "전체 컨텐츠 열람"
// 권한(SUPER_ADMIN/ADMIN)을 기준으로 하므로, 이 역할만 조회할 수 있습니다(Firestore 보안규칙상
// 일반 사용자는 본인이 권한 없는 회의의 질문까지 한 번에 조회할 수 없어 "내 업무" 화면을 대신 씁니다).

const BOARD_COLUMNS: { key: string; label: string; statuses: QuestionStatus[] }[] = [
  { key: "PENDING", label: "답변대기", statuses: ["ANSWER_PENDING", "OVERDUE"] },
  { key: "IN_PROGRESS", label: "진행중", statuses: ["IN_PROGRESS", "NEXT_MEETING"] },
  { key: "NEEDS_CONFIRMATION", label: "확인필요", statuses: ["NEEDS_CONFIRMATION"] },
  { key: "DONE", label: "답변완료", statuses: ["ANSWERED", "CLOSED"] },
];

function startOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 월요일 시작
  return new Date(d.getFullYear(), d.getMonth(), diff);
}
function endOfWeek(): Date {
  const s = startOfWeek();
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6, 23, 59, 59);
}

function QnaContent() {
  const { profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);
  const canView = profile?.org_role === "SUPER_ADMIN" || profile?.org_role === "ADMIN";

  const [projects, setProjects] = useState<Project[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [firstAnswerAt, setFirstAnswerAt] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [myOnly, setMyOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "list">("board");

  useEffect(() => {
    if (!profile || !canView) return;
    let cancelled = false;
    async function load() {
      try {
        const [projSnap, qSnap] = await Promise.all([
          getDocs(query(collection(db, "projects"), where("organization_id", "==", profile!.organization_id))),
          getDocs(query(collection(db, "questions"), where("organization_id", "==", profile!.organization_id))),
        ]);
        if (cancelled) return;
        setProjects(projSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
        const qs = qSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Question));
        setQuestions(qs);

        // 평균 응답소요 계산을 위해 답변완료/종료 건의 첫 답변 시각만 모읍니다.
        const targets = qs.filter((q) => q.question_status === "ANSWERED" || q.question_status === "CLOSED");
        const entries = await Promise.all(
          targets.map(async (q) => {
            const ansSnap = await getDocs(collection(db, "questions", q.id, "answers"));
            const answers = ansSnap.docs.map((d) => d.data() as Answer);
            if (answers.length === 0) return null;
            const first = Math.min(...answers.map((a) => a.answered_at));
            return [q.id, first] as const;
          })
        );
        if (cancelled) return;
        setFirstAnswerAt(Object.fromEntries(entries.filter((e): e is readonly [string, number] => e !== null)));
      } catch (e) {
        console.error("[QnaPage] 조회 실패:", e);
        setError("Q&A 데이터를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [profile, canView]);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.project_name || "(알 수 없는 프로젝트)";

  const filtered = useMemo(() => {
    return questions.filter((q) => {
      if (projectFilter !== "ALL" && q.project_id !== projectFilter) return false;
      if (myOnly && q.assignee_user_id !== profile?.id) return false;
      if (search.trim() && !q.question_content.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [questions, projectFilter, myOnly, search, profile]);

  const stats = useMemo(() => {
    const today = new Date();
    const weekStart = startOfWeek();
    const weekEnd = endOfWeek();
    const unresolved = filtered.filter((q) => q.question_status !== "ANSWERED" && q.question_status !== "CLOSED");
    const overdue = unresolved.filter((q) => {
      if (q.question_status === "OVERDUE") return true;
      if (!q.due_date) return false;
      return new Date(q.due_date) < today;
    });
    const dueThisWeek = unresolved.filter((q) => {
      if (!q.due_date) return false;
      const d = new Date(q.due_date);
      return d >= weekStart && d <= weekEnd;
    });
    const resolvedWithAnswer = filtered.filter((q) => firstAnswerAt[q.id]);
    const avgResponseDays =
      resolvedWithAnswer.length > 0
        ? resolvedWithAnswer.reduce((sum, q) => sum + (firstAnswerAt[q.id] - q.created_at), 0) /
          resolvedWithAnswer.length /
          86400000
        : null;

    return {
      unresolved: unresolved.length,
      overdue: overdue.length,
      dueThisWeek: dueThisWeek.length,
      avgResponseDays,
    };
  }, [filtered, firstAnswerAt]);

  if (!canView) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <p className="p-8 text-center text-sm text-gray-400">Q&A 관리는 관리자(전체 컨텐츠 열람 권한) 이상만 접근할 수 있습니다. 본인 문답은 &quot;내 업무&quot; 화면을 이용하세요.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold text-navy">Q&A 관리</h1>

        {loading ? (
          <p className="p-8 text-center text-sm text-gray-400">불러오는 중…</p>
        ) : error ? (
          <p className="p-8 text-center text-sm text-red-600">{error}</p>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-4 gap-4">
              <StatCard label="전체 미해결" value={stats.unresolved} />
              <StatCard label="기한초과" value={stats.overdue} tone="text-red-600" />
              <StatCard label="이번주 마감" value={stats.dueThisWeek} tone="text-amber-600" />
              <StatCard
                label="평균 응답소요"
                value={stats.avgResponseDays !== null ? `${stats.avgResponseDays.toFixed(1)}일` : "-"}
              />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                className={`rounded-full px-3 py-1 text-xs font-medium ${projectFilter === "ALL" ? "bg-navy text-white" : "bg-gray-100 text-gray-600"}`}
                onClick={() => setProjectFilter("ALL")}
              >
                전체 프로젝트
              </button>
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${projectFilter === p.id ? "bg-navy text-white" : "bg-gray-100 text-gray-600"}`}
                  onClick={() => setProjectFilter(p.id)}
                >
                  {p.project_name}
                </button>
              ))}
              <button
                className={`rounded-full px-3 py-1 text-xs font-medium ${myOnly ? "bg-mint text-navy" : "bg-gray-100 text-gray-600"}`}
                onClick={() => setMyOnly((v) => !v)}
              >
                내 담당만
              </button>
              <input
                className="input ml-auto w-56 text-xs"
                placeholder="질문 내용 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs">
                <button
                  className={`px-3 py-1.5 ${view === "board" ? "bg-navy text-white" : "bg-white text-gray-600"}`}
                  onClick={() => setView("board")}
                >
                  보드형
                </button>
                <button
                  className={`px-3 py-1.5 ${view === "list" ? "bg-navy text-white" : "bg-white text-gray-600"}`}
                  onClick={() => setView("list")}
                >
                  리스트형
                </button>
              </div>
            </div>

            {view === "board" ? (
              <div className="grid grid-cols-4 gap-4">
                {BOARD_COLUMNS.map((col) => {
                  const items = filtered.filter((q) => col.statuses.includes(q.question_status));
                  return (
                    <div key={col.key} className="rounded-lg bg-gray-50 p-3">
                      <p className="mb-3 text-xs font-semibold text-gray-500">{col.label} ({items.length})</p>
                      <div className="flex flex-col gap-2">
                        {items.map((q) => (
                          <QnaCard key={q.id} q={q} projectName={projectName(q.project_id)} dir={dir} />
                        ))}
                        {items.length === 0 && <p className="text-xs text-gray-300">없음</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((q) => (
                  <Link
                    key={q.id}
                    href={`/meetings/${q.meeting_id}`}
                    className="card flex items-center justify-between p-4 text-sm hover:border-navy"
                  >
                    <div>
                      <span className={`badge ${QUESTION_STATUS_BADGE[q.question_status]} mr-2`}>{QUESTION_STATUS_LABEL[q.question_status]}</span>
                      <span className="text-ink">{q.question_content}</span>
                      <p className="mt-1 text-xs text-gray-400">
                        {projectName(q.project_id)} · 질문자 {dir.displayName(q.questioner_user_id)} · 담당 {dir.displayName(q.assignee_user_id)} · 기한 {q.due_date || "없음"}
                      </p>
                    </div>
                  </Link>
                ))}
                {filtered.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">조건에 맞는 문답이 없습니다.</p>}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone || "text-navy"}`}>{value}</p>
    </div>
  );
}

function QnaCard({ q, projectName, dir }: { q: Question; projectName: string; dir: ReturnType<typeof useDirectory> }) {
  return (
    <Link href={`/meetings/${q.meeting_id}`} className="card block p-3 text-xs hover:border-navy">
      <p className="mb-1 line-clamp-2 text-ink">{q.question_content}</p>
      <p className="text-gray-400">{projectName}</p>
      <p className="text-gray-400">담당 {dir.displayName(q.assignee_user_id)} {q.due_date ? `· 기한 ${q.due_date}` : ""}</p>
    </Link>
  );
}

export default function QnaPage() {
  return (
    <AuthGate>
      <QnaContent />
    </AuthGate>
  );
}
