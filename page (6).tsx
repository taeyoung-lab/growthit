"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { useDirectory } from "@/lib/firestore/useDirectory";
import { QUESTION_STATUS_LABEL, QUESTION_STATUS_BADGE, ACTION_ITEM_STATUS_LABEL } from "@/lib/statusLabels";
import type { ActionItem, Question } from "@/lib/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 font-semibold text-ink">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function MyDashboardContent() {
  const { firebaseUser, profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);
  const [asked, setAsked] = useState<Question[]>([]);
  const [toAnswer, setToAnswer] = useState<Question[]>([]);
  const [myActions, setMyActions] = useState<ActionItem[]>([]);

  useEffect(() => {
    if (!firebaseUser) return;
    getDocs(query(collection(db, "questions"), where("questioner_user_id", "==", firebaseUser.uid))).then((s) =>
      setAsked(s.docs.map((d) => ({ id: d.id, ...d.data() } as Question)))
    );
    getDocs(query(collection(db, "questions"), where("assignee_user_id", "==", firebaseUser.uid))).then((s) =>
      setToAnswer(s.docs.map((d) => ({ id: d.id, ...d.data() } as Question)).filter((q) => q.question_status !== "CLOSED"))
    );
    getDocs(query(collection(db, "actionItems"), where("assignee_user_ids", "array-contains", firebaseUser.uid))).then((s) =>
      setMyActions(s.docs.map((d) => ({ id: d.id, ...d.data() } as ActionItem)))
    );
  }, [firebaseUser]);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold text-navy">내 업무</h1>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <Section title={`내가 질문한 것 (${asked.length})`}>
            {asked.map((q) => (
              <Link key={q.id} href={`/meetings/${q.meeting_id}?tab=questions`} className="card p-3 text-sm hover:border-mint">
                <span className={`badge ${QUESTION_STATUS_BADGE[q.question_status]}`}>{QUESTION_STATUS_LABEL[q.question_status]}</span>
                <p className="mt-2 line-clamp-2 text-ink">{q.question_content}</p>
              </Link>
            ))}
            {asked.length === 0 && <p className="text-sm text-gray-400">없음</p>}
          </Section>

          <Section title={`내가 답변해야 하는 질의 (${toAnswer.length})`}>
            {toAnswer.map((q) => (
              <Link key={q.id} href={`/meetings/${q.meeting_id}?tab=questions`} className="card p-3 text-sm hover:border-mint">
                <span className={`badge ${QUESTION_STATUS_BADGE[q.question_status]}`}>{QUESTION_STATUS_LABEL[q.question_status]}</span>
                <p className="mt-2 line-clamp-2 text-ink">{q.question_content}</p>
                <p className="mt-1 text-xs text-gray-400">질문자 {dir.displayName(q.questioner_user_id)} · 기한 {q.due_date || "없음"}</p>
              </Link>
            ))}
            {toAnswer.length === 0 && <p className="text-sm text-gray-400">없음</p>}
          </Section>

          <Section title={`내가 담당한 업무 (${myActions.length})`}>
            {myActions.map((a) => (
              <Link key={a.id} href={`/meetings/${a.meeting_id}?tab=actions`} className="card p-3 text-sm hover:border-mint">
                <p className="font-medium text-ink">{a.title}</p>
                <p className="mt-1 text-xs text-gray-400">{ACTION_ITEM_STATUS_LABEL[a.status]} · 기한 {a.due_date || "없음"}</p>
              </Link>
            ))}
            {myActions.length === 0 && <p className="text-sm text-gray-400">없음</p>}
          </Section>
        </div>
      </main>
    </div>
  );
}

export default function MyDashboardPage() {
  return (
    <AuthGate>
      <MyDashboardContent />
    </AuthGate>
  );
}
