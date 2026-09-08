"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDocs, orderBy, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { useDirectory } from "@/lib/firestore/useDirectory";
import type { AttendeePerson, Meeting, Project, Question } from "@/lib/types";
import { QUESTION_STATUS_LABEL } from "@/lib/statusLabels";

const OPEN_STATUSES = ["ANSWER_PENDING", "IN_PROGRESS", "NEEDS_CONFIRMATION", "NEXT_MEETING", "OVERDUE"];

interface TopicRow {
  title: string;
  content: string;
}

interface TaskRow {
  assignee_user_ids: string[];
  title: string;
  due_date: string;
  note: string;
}

function emptyAttendee(): AttendeePerson {
  return { name: "", title: "" };
}

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
  const [submitting, setSubmitting] = useState(false);

  // (1) 개요
  const [title, setTitle] = useState(""); // 회의 목적 = 제목
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("");
  const [location, setLocation] = useState("");
  const [clientCompanyName, setClientCompanyName] = useState("");
  const [clientAttendees, setClientAttendees] = useState<AttendeePerson[]>([emptyAttendee()]);
  const [wylieAttendees, setWylieAttendees] = useState<AttendeePerson[]>([emptyAttendee()]);

  // (2) 회의 요약
  const [summaryText, setSummaryText] = useState("");

  // (3) 논의내용 (제목+내용, "+"로 무한 생성)
  const [topics, setTopics] = useState<TopicRow[]>([{ title: "", content: "" }]);

  // (4) 향후추진과제 (담당주체/주요추진과제/추진일정/비고, "+"로 무한 생성)
  const [tasks, setTasks] = useState<TaskRow[]>([{ assignee_user_ids: [], title: "", due_date: "", note: "" }]);

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

  function updateAttendee(list: AttendeePerson[], setList: (v: AttendeePerson[]) => void, idx: number, field: keyof AttendeePerson, value: string) {
    setList(list.map((a, i) => (i === idx ? { ...a, [field]: value } : a)));
  }

  function updateTopic(idx: number, field: keyof TopicRow, value: string) {
    setTopics(topics.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  }

  function updateTask(idx: number, field: keyof TaskRow, value: string | string[]) {
    setTasks(tasks.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser || !profile || !projectId || !title.trim()) return;
    setSubmitting(true);

    const now = Date.now();
    const meetingRef = doc(collection(db, "meetings"));

    await setDoc(meetingRef, {
      id: meetingRef.id,
      project_id: projectId,
      organization_id: profile.organization_id,
      meeting_title: title.trim(),
      meeting_date: date,
      meeting_start_time: startTime || null,
      meeting_end_time: null,
      location: location.trim(),
      attendees: {
        client_company_name: clientCompanyName.trim(),
        client_attendees: clientAttendees.filter((a) => a.name.trim()),
        wylie_attendees: wylieAttendees.filter((a) => a.name.trim()),
      },
      created_by_user_id: firebaseUser.uid,
      meeting_status: "COMPLETED",
      member_uids: [firebaseUser.uid],
      created_at: now,
      updated_at: now,
    } satisfies Meeting);

    await setDoc(doc(db, "meetings", meetingRef.id, "permissions", firebaseUser.uid), {
      user_id: firebaseUser.uid,
      role: "AUTHOR",
      granted_by_user_id: firebaseUser.uid,
      granted_at: now,
    });

    await setDoc(doc(db, "meetingSummaries", meetingRef.id), {
      id: meetingRef.id,
      meeting_id: meetingRef.id,
      summary_text: summaryText.trim(),
      topics: topics.filter((t) => t.title.trim() || t.content.trim()),
      created_at: now,
      updated_at: now,
    });

    for (const t of tasks) {
      if (!t.title.trim()) continue;
      const taskRef = doc(collection(db, "actionItems"));
      await setDoc(taskRef, {
        id: taskRef.id,
        meeting_id: meetingRef.id,
        project_id: projectId,
        organization_id: profile.organization_id,
        title: t.title.trim(),
        description: t.note.trim(),
        status: "TODO",
        due_date: t.due_date || null,
        created_by_user_id: firebaseUser.uid,
        assignee_user_ids: t.assignee_user_ids,
        created_at: now,
        updated_at: now,
      });
    }

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

  const orgUserOptions = Object.values(dir.users);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold text-navy">회의록 작성</h1>

        <form onSubmit={handleCreate} className="flex flex-col gap-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">프로젝트</label>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
              <option value="">선택하세요</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.project_name}</option>
              ))}
            </select>
          </div>

          {projectId && prevMeetings.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">이전 회의와 연결 (선택)</label>
              <select className="input" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                <option value="">연결 안 함</option>
                {prevMeetings.map((m) => (
                  <option key={m.id} value={m.id}>{m.meeting_date} · {m.meeting_title}</option>
                ))}
              </select>
            </div>
          )}

          {projectId && openQuestions.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="mb-2 text-sm font-medium text-amber-800">이 프로젝트에 미결된 문답이 {openQuestions.length}건 있습니다.</p>
              <ul className="flex flex-col gap-1 text-sm text-amber-700">
                {openQuestions.slice(0, 5).map((q) => (
                  <li key={q.id}>· {q.question_content} ({QUESTION_STATUS_LABEL[q.question_status]} · 담당 {dir.displayName(q.assignee_user_id)})</li>
                ))}
              </ul>
            </div>
          )}

          {/* (1) 개요 */}
          <section className="card flex flex-col gap-4 p-6">
            <h2 className="font-semibold text-ink">1. 개요</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">일시</label>
                <div className="flex gap-2">
                  <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
                  <input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">장소</label>
                <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="예: 본사 3층 회의실" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">회의 목적 (제목)</label>
              <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">참석자 — 고객사</label>
                <input
                  className="input mb-2 w-full"
                  placeholder="회사명"
                  value={clientCompanyName}
                  onChange={(e) => setClientCompanyName(e.target.value)}
                />
                {clientAttendees.map((a, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <input className="input" placeholder="이름" value={a.name} onChange={(e) => updateAttendee(clientAttendees, setClientAttendees, i, "name", e.target.value)} />
                    <input className="input" placeholder="직책" value={a.title} onChange={(e) => updateAttendee(clientAttendees, setClientAttendees, i, "title", e.target.value)} />
                  </div>
                ))}
                <button type="button" className="btn btn-secondary text-xs" onClick={() => setClientAttendees([...clientAttendees, emptyAttendee()])}>
                  + 참석자 추가
                </button>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">참석자 — 와일리</label>
                {wylieAttendees.map((a, i) => (
                  <div key={i} className="mb-2 flex gap-2">
                    <input className="input" placeholder="이름" value={a.name} onChange={(e) => updateAttendee(wylieAttendees, setWylieAttendees, i, "name", e.target.value)} />
                    <input className="input" placeholder="직책" value={a.title} onChange={(e) => updateAttendee(wylieAttendees, setWylieAttendees, i, "title", e.target.value)} />
                  </div>
                ))}
                <button type="button" className="btn btn-secondary text-xs" onClick={() => setWylieAttendees([...wylieAttendees, emptyAttendee()])}>
                  + 참석자 추가
                </button>
              </div>
            </div>
          </section>

          {/* (2) 회의 요약 */}
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="font-semibold text-ink">2. 회의 요약</h2>
            <textarea className="input h-28" value={summaryText} onChange={(e) => setSummaryText(e.target.value)} placeholder="회의 전체 요약을 입력하세요." />
          </section>

          {/* (3) 논의내용 */}
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="font-semibold text-ink">3. 논의내용</h2>
            {topics.map((t, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-3">
                <input
                  className="input mb-2 w-full"
                  placeholder="제목"
                  value={t.title}
                  onChange={(e) => updateTopic(i, "title", e.target.value)}
                />
                <textarea
                  className="input w-full"
                  placeholder="내용"
                  value={t.content}
                  onChange={(e) => updateTopic(i, "content", e.target.value)}
                />
              </div>
            ))}
            <button type="button" className="btn btn-secondary self-start text-xs" onClick={() => setTopics([...topics, { title: "", content: "" }])}>
              + 논의내용 추가
            </button>
          </section>

          {/* (4) 향후추진과제 */}
          <section className="card flex flex-col gap-3 p-6">
            <h2 className="font-semibold text-ink">4. 향후추진과제</h2>
            <div className="flex flex-col gap-3">
              {tasks.map((t, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 rounded-lg border border-gray-200 p-3">
                  <select
                    multiple
                    className="input text-xs"
                    value={t.assignee_user_ids}
                    onChange={(e) => updateTask(i, "assignee_user_ids", Array.from(e.target.selectedOptions).map((o) => o.value))}
                  >
                    {orgUserOptions.map((u) => (
                      <option key={u.id} value={u.id}>{u.user_name}</option>
                    ))}
                  </select>
                  <input className="input" placeholder="주요 추진과제" value={t.title} onChange={(e) => updateTask(i, "title", e.target.value)} />
                  <input type="date" className="input" value={t.due_date} onChange={(e) => updateTask(i, "due_date", e.target.value)} />
                  <input className="input" placeholder="비고" value={t.note} onChange={(e) => updateTask(i, "note", e.target.value)} />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-secondary self-start text-xs"
              onClick={() => setTasks([...tasks, { assignee_user_ids: [], title: "", due_date: "", note: "" }])}
            >
              + 향후추진과제 추가
            </button>
          </section>

          <button type="submit" className="btn btn-primary self-start" disabled={submitting || !projectId || !title.trim()}>
            {submitting ? "저장 중…" : "저장하고 회의 상세로 이동"}
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
