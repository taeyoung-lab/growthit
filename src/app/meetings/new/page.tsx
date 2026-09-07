"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDocs, orderBy, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { useDirectory } from "@/lib/firestore/useDirectory";
import type { Meeting, Project, Question } from "@/lib/types";
import { QUESTION_STATUS_LABEL } from "@/lib/statusLabels";

const OPEN_STATUSES = ["ANSWER_PENDING", "IN_PROGRESS", "NEEDS_CONFIRMATION", "NEXT_MEETING", "OVERDUE"];

function NewMeetingContent() {
  const { firebaseUser, profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);
  const router = useRouter();
  const params = useSearchParams();

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get("project") || "");
  const [prevMeetings, setPrevMeetings] = useState<Meeting[]>([]);
  const [openQuestions, setOpenQuestions] = useState<Question[]>([]);
  const [linkTo, setLinkTo] = useState("");

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!profile) return;
    getDocs(query(collection(db, "projects"), where("organization_id", "==", profile.organization_id))).then((s) =>
      setProjects(s.docs.map((d) => ({ id: d.id, ...d.data() } as Project)))
    );
  }, [profile]);

  useEffect(() => {
    if (!projectId) {
      setPrevMeetings([]);
      setOpenQuestions([]);
      return;
    }
    getDocs(
      query(collection(db, "meetings"), where("project_id", "==", projectId), orderBy("meeting_date", "desc"))
    ).then((s) => setPrevMeetings(s.docs.map((d) => d.data() as Meeting)));

    getDocs(
      query(collection(db, "questions"), where("project_id", "==", projectId), where("question_status", "in", OPEN_STATUSES))
    ).then((s) => setOpenQuestions(s.docs.map((d) => d.data() as Question)));
  }, [projectId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser || !profile || !projectId || !title.trim()) return;
    setSubmitting(true);

    const meetingRef = doc(collection(db, "meetings"));
    const now = Date.now();
    await setDoc(meetingRef, {
      id: meetingRef.id,
      project_id: projectId,
      organization_id: profile.organization_id,
      meeting_title: title.trim(),
      meeting_date: date,
      meeting_start_time: null,
      meeting_end_time: null,
      created_by_user_id: firebaseUser.uid,
      meeting_status: "SCHEDULED",
      member_uids: [firebaseUser.uid],
      created_at: now,
      updated_at: now,
    });

    await setDoc(doc(db, "meetings", meetingRef.id, "permissions", firebaseUser.uid), {
      user_id: firebaseUser.uid,
      role: "AUTHOR",
      granted_by_user_id: firebaseUser.uid,
      granted_at: now,
    });

    await setDoc(doc(db, "meetings", meetingRef.id, "participants", firebaseUser.uid), {
      user_id: firebaseUser.uid,
      participant_type: "HOST",
      attendance_status: "CONFIRMED",
      created_at: now,
    });

    await setDoc(doc(db, "transcripts", meetingRef.id), {
      id: meetingRef.id,
      meeting_id: meetingRef.id,
      input_method: "TEXT_MANUAL",
      transcript_status: "DRAFT",
      raw_text: "",
      created_at: now,
      updated_at: now,
    });

    if (linkTo) {
      const relRef = doc(collection(db, "meetingRelations"));
      await setDoc(relRef, {
        id: relRef.id,
        parent_meeting_id: linkTo,
        child_meeting_id: meetingRef.id,
        relation_type: "FOLLOW_UP",
        created_by: firebaseUser.uid,
        created_at: now,
      });
    }

    router.push(`/meetings/${meetingRef.id}`);
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold text-navy">회의 생성</h1>

        <form onSubmit={handleCreate} className="card flex flex-col gap-4 p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">프로젝트</label>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
              <option value="">선택하세요</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">회의 제목</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">회의 날짜</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>

          {projectId && prevMeetings.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">이전 회의와 연결 (18장, 선택)</label>
              <select className="input" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                <option value="">연결 안 함</option>
                {prevMeetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.meeting_date} · {m.meeting_title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {projectId && openQuestions.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="mb-2 text-sm font-medium text-amber-800">
                이 프로젝트에 미결된 사항이 {openQuestions.length}건 있습니다.
              </p>
              <ul className="flex flex-col gap-1 text-sm text-amber-700">
                {openQuestions.slice(0, 5).map((q) => (
                  <li key={q.id}>
                    · {q.question_content} ({QUESTION_STATUS_LABEL[q.question_status]} · 담당 {dir.displayName(q.assignee_user_id)})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="submit" className="btn btn-primary self-start" disabled={submitting || !projectId || !title.trim()}>
            {submitting ? "생성 중…" : "회의 생성하고 회의록 입력으로 이동"}
          </button>
        </form>
      </main>
    </div>
  );
}

export default function NewMeetingPage() {
  return (
    <AuthGate>
      <Suspense>
        <NewMeetingContent />
      </Suspense>
    </AuthGate>
  );
}
