"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, or, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { useDirectory } from "@/lib/firestore/useDirectory";
import { authedFetch } from "@/lib/apiClient";
import { QUESTION_STATUS_LABEL, QUESTION_STATUS_BADGE, ACTION_ITEM_STATUS_LABEL, questionPriorityScore } from "@/lib/statusLabels";
import type { ActionItem, Meeting, Question } from "@/lib/types";
import { Search, Sparkles } from "lucide-react";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function DashboardContent() {
  const { firebaseUser, profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);
  const isAdmin = profile?.org_role === "SUPER_ADMIN" || profile?.org_role === "ADMIN";

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [updateCount, setUpdateCount] = useState<number | null>(null);

  const [filterTitle, setFilterTitle] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterParticipant, setFilterParticipant] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  useEffect(() => {
    if (!firebaseUser || !profile) return;
    (async () => {
      const mQuery = query(
        collection(db, "meetings"),
        where("member_uids", "array-contains", firebaseUser.uid),
        orderBy("meeting_date", "desc")
      );
      const mSnap = await getDocs(mQuery);
      const loadedMeetings = mSnap.docs.map((d) => d.data() as Meeting);
      setMeetings(loadedMeetings);

      const qQuery = query(
        collection(db, "questions"),
        or(where("assignee_user_id", "==", firebaseUser.uid), where("questioner_user_id", "==", firebaseUser.uid))
      );
      const qSnap = await getDocs(qQuery);
      const loadedQuestions = qSnap.docs.map((d) => d.data() as Question);
      setQuestions(loadedQuestions.filter((q) => q.question_status !== "CLOSED"));

      // 향후추진과제(담당자별): 내가 접근 가능한 회의(=이미 위에서 확인됨) 범위 안에서만 조회합니다.
      // (actionItems 보안규칙이 회의 단위 접근권한을 기준으로 하므로, 이 범위를 벗어나면 조회가 거부됩니다.)
      let loadedActionItems: ActionItem[] = [];
      if (isAdmin) {
        const aSnap = await getDocs(query(collection(db, "actionItems"), where("organization_id", "==", profile.organization_id)));
        loadedActionItems = aSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ActionItem));
      } else if (loadedMeetings.length > 0) {
        const meetingIdChunks = chunk(loadedMeetings.map((m) => m.id), 30);
        const results = await Promise.all(
          meetingIdChunks.map((ids) => getDocs(query(collection(db, "actionItems"), where("meeting_id", "in", ids))))
        );
        loadedActionItems = results.flatMap((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActionItem)));
      }
      setActionItems(loadedActionItems);

      // 알림 축소: 개별 알림 대신 "지난 방문 이후 업데이트" 건수만 계산합니다.
      try {
        const res = await authedFetch("/api/account/mark-dashboard-visited", { method: "POST" });
        const since: number | null = res.previous;
        if (since) {
          const count =
            loadedMeetings.filter((m) => m.updated_at > since).length +
            loadedQuestions.filter((q) => q.updated_at > since).length +
            loadedActionItems.filter((a) => a.updated_at > since).length;
          setUpdateCount(count);
        } else {
          setUpdateCount(null); // 첫 방문 — 비교 기준 없음
        }
      } catch {
        // 알림 갱신은 부가 기능이므로 실패해도 대시보드 본 기능에는 영향 없음
      }
    })();
  }, [firebaseUser, profile, isAdmin]);

  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (filterTitle && !m.meeting_title.includes(filterTitle)) return false;
      if (filterFrom && m.meeting_date < filterFrom) return false;
      if (filterTo && m.meeting_date > filterTo) return false;
      if (filterCompany && !m.attendees?.client_company_name?.includes(filterCompany)) return false;
      if (filterParticipant) {
        const inClient = m.attendees?.client_attendees?.some((a) => a.name.includes(filterParticipant));
        const inWylie = m.attendees?.wylie_attendees?.some((a) => a.name.includes(filterParticipant));
        if (!inClient && !inWylie) return false;
      }
      return true;
    });
  }, [meetings, filterTitle, filterFrom, filterTo, filterCompany, filterParticipant]);

  const sortedQuestions = useMemo(
    () =>
      [...questions].sort(
        (a, b) => questionPriorityScore(a.question_status, a.due_date) - questionPriorityScore(b.question_status, b.due_date)
      ),
    [questions]
  );

  const tasksByAssignee = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const item of actionItems) {
      if (item.status === "DONE" || item.status === "CANCELLED") continue;
      for (const uid of item.assignee_user_ids.length > 0 ? item.assignee_user_ids : ["__unassigned__"]) {
        if (!map.has(uid)) map.set(uid, []);
        map.get(uid)!.push(item);
      }
    }
    return map;
  }, [actionItems]);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-navy">메인 대시보드</h1>
          {updateCount !== null && (
            <div className="flex items-center gap-2 rounded-full bg-mint/10 px-4 py-1.5 text-xs font-medium text-navy">
              <Sparkles size={14} />
              지난 방문 이후 {updateCount}건 업데이트
            </div>
          )}
        </div>

        <div className="card mb-6 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-500">
            <Search size={14} /> 통합 검색 (모든 조건은 AND로 적용됩니다)
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <input className="input" placeholder="고객사명" value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)} />
            <input className="input" placeholder="참석자" value={filterParticipant} onChange={(e) => setFilterParticipant(e.target.value)} />
            <input className="input" placeholder="회의 제목" value={filterTitle} onChange={(e) => setFilterTitle(e.target.value)} />
            <input className="input" type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            <input className="input" type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-ink">회의록 목록 ({filteredMeetings.length})</h2>
              <Link href="/meetings/new" className="btn btn-primary text-xs">+ 회의록 작성</Link>
            </div>
            <div className="flex flex-col gap-2">
              {filteredMeetings.map((m) => (
                <Link key={m.id} href={`/meetings/${m.id}`} className="card flex items-center justify-between p-4 hover:border-mint">
                  <div>
                    <div className="font-medium text-ink">{m.meeting_title}</div>
                    <div className="mt-1 text-xs text-gray-400">
                      {m.attendees?.client_company_name || "-"} · {m.meeting_date} · {m.location || "장소 미기재"}
                    </div>
                  </div>
                </Link>
              ))}
              {filteredMeetings.length === 0 && (
                <p className="card p-6 text-center text-sm text-gray-400">조건에 맞는 회의록이 없습니다.</p>
              )}
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-ink">내 미답변 질의</h2>
            <div className="flex flex-col gap-2">
              {sortedQuestions.map((q) => (
                <Link key={q.id} href={`/meetings/${q.meeting_id}`} className="card block p-3 hover:border-mint">
                  <span className={`badge ${QUESTION_STATUS_BADGE[q.question_status]}`}>{QUESTION_STATUS_LABEL[q.question_status]}</span>
                  <p className="mt-2 line-clamp-2 text-sm text-ink">{q.question_content}</p>
                  <div className="mt-2 flex justify-between text-xs text-gray-400">
                    <span>담당 {dir.displayName(q.assignee_user_id)}</span>
                    <span>{q.due_date || "기한 없음"}</span>
                  </div>
                </Link>
              ))}
              {sortedQuestions.length === 0 && (
                <p className="card p-6 text-center text-sm text-gray-400">미답변 질의가 없습니다.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h2 className="mb-3 font-semibold text-ink">향후추진과제 (담당자별)</h2>
          {tasksByAssignee.size === 0 ? (
            <p className="card p-6 text-center text-sm text-gray-400">진행 중인 향후추진과제가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {Array.from(tasksByAssignee.entries()).map(([uid, items]) => (
                <div key={uid} className="card p-4">
                  <p className="mb-3 text-sm font-semibold text-navy">
                    {uid === "__unassigned__" ? "담당자 미지정" : dir.displayName(uid)} ({items.length})
                  </p>
                  <div className="flex flex-col gap-2">
                    {items.map((item) => (
                      <Link key={item.id} href={`/meetings/${item.meeting_id}`} className="block rounded-lg bg-gray-50 p-3 text-xs hover:bg-gray-100">
                        <p className="font-medium text-ink">{item.title}</p>
                        <div className="mt-1 flex justify-between text-gray-400">
                          <span>{item.due_date || "기한 없음"}</span>
                          <span className="badge badge-progress">{ACTION_ITEM_STATUS_LABEL[item.status]}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <AuthGate>
      <DashboardContent />
    </AuthGate>
  );
}
