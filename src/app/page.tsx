"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, or, orderBy, query, updateDoc, doc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { useDirectory } from "@/lib/firestore/useDirectory";
import { QUESTION_STATUS_LABEL, QUESTION_STATUS_BADGE, questionPriorityScore } from "@/lib/statusLabels";
import type { AppNotification, Meeting, Question } from "@/lib/types";
import { Bell, Search } from "lucide-react";

function DashboardContent() {
  const { firebaseUser, profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotif, setShowNotif] = useState(false);

  const [filterTitle, setFilterTitle] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterParticipant, setFilterParticipant] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  useEffect(() => {
    if (!firebaseUser) return;
    (async () => {
      const mQuery = query(
        collection(db, "meetings"),
        where("member_uids", "array-contains", firebaseUser.uid),
        orderBy("meeting_date", "desc")
      );
      const mSnap = await getDocs(mQuery);
      setMeetings(mSnap.docs.map((d) => d.data() as Meeting));

      const qQuery = query(
        collection(db, "questions"),
        or(where("assignee_user_id", "==", firebaseUser.uid), where("questioner_user_id", "==", firebaseUser.uid))
      );
      const qSnap = await getDocs(qQuery);
      setQuestions(qSnap.docs.map((d) => d.data() as Question).filter((q) => q.question_status !== "CLOSED"));

      const nQuery = query(
        collection(db, "notifications"),
        where("user_id", "==", firebaseUser.uid),
        orderBy("created_at", "desc")
      );
      const nSnap = await getDocs(nQuery);
      setNotifications(nSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AppNotification)));
    })();
  }, [firebaseUser]);

  const filteredMeetings = useMemo(() => {
    return meetings.filter((m) => {
      if (filterTitle && !m.meeting_title.includes(filterTitle)) return false;
      if (filterFrom && m.meeting_date < filterFrom) return false;
      if (filterTo && m.meeting_date > filterTo) return false;
      if (filterCompany && dir.organizations[m.organization_id]?.organization_name !== filterCompany) return false;
      if (filterParticipant) {
        const match = Object.values(dir.users).find((u) => u.user_name.includes(filterParticipant));
        if (!match || !m.member_uids.includes(match.id)) return false;
      }
      return true;
    });
  }, [meetings, filterTitle, filterFrom, filterTo, filterCompany, filterParticipant, dir]);

  const sortedQuestions = useMemo(
    () =>
      [...questions].sort(
        (a, b) => questionPriorityScore(a.question_status, a.due_date) - questionPriorityScore(b.question_status, b.due_date)
      ),
    [questions]
  );

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function markRead(n: AppNotification) {
    if (n.is_read) return;
    await updateDoc(doc(db, "notifications", n.id), { is_read: true, read_at: Date.now() });
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-navy">메인 대시보드</h1>
          <div className="relative">
            <button onClick={() => setShowNotif((v) => !v)} className="btn btn-secondary relative">
              <Bell size={16} />
              알림
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
                  {unreadCount}
                </span>
              )}
            </button>
            {showNotif && (
              <div className="absolute right-0 z-10 mt-2 w-80 card max-h-96 overflow-y-auto p-2">
                {notifications.length === 0 && <p className="p-3 text-sm text-gray-400">알림이 없습니다.</p>}
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => markRead(n)}
                    className={`block w-full rounded-lg p-3 text-left text-sm hover:bg-gray-50 ${
                      n.is_read ? "text-gray-400" : "text-ink"
                    }`}
                  >
                    <div className="font-medium">{n.title}</div>
                    <div className="truncate text-xs text-gray-400">{n.content}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card mb-6 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-500">
            <Search size={14} /> 통합 검색 (모든 조건은 AND로 적용됩니다)
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <input className="input" placeholder="회사명" value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)} />
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
              <Link href="/meetings/new" className="btn btn-primary text-xs">
                + 회의 생성
              </Link>
            </div>
            <div className="flex flex-col gap-2">
              {filteredMeetings.map((m) => (
                <Link key={m.id} href={`/meetings/${m.id}`} className="card flex items-center justify-between p-4 hover:border-mint">
                  <div>
                    <div className="font-medium text-ink">{m.meeting_title}</div>
                    <div className="mt-1 text-xs text-gray-400">
                      {dir.organizations[m.organization_id]?.organization_name} · {m.meeting_date} · 참석자 {m.member_uids.length}명
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
                <Link
                  key={q.id}
                  href={`/meetings/${q.meeting_id}?tab=questions`}
                  className="card block p-3 hover:border-mint"
                >
                  <span className={`badge ${QUESTION_STATUS_BADGE[q.question_status]}`}>
                    {QUESTION_STATUS_LABEL[q.question_status]}
                  </span>
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
