"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addDoc, collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import type { Project } from "@/lib/types";

function ProjectsContent() {
  const { profile } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function load() {
    if (!profile) return;
    try {
      setLoadError(null);
      // where + orderBy(다른 필드) 조합은 Firestore 복합 색인이 필요합니다. 조직당 프로젝트 수는
      // 많지 않으므로 색인 배포에 의존하지 않도록 정렬은 클라이언트에서 처리합니다.
      const snap = await getDocs(query(collection(db, "projects"), where("organization_id", "==", profile.organization_id)));
      const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Project));
      loaded.sort((a, b) => b.created_at - a.created_at);
      setProjects(loaded);
    } catch (error) {
      console.error("[ProjectsPage] 프로젝트 목록 조회 실패:", error);
      setLoadError("프로젝트 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !name.trim()) return;
    setCreating(true);
    setCreateError(null);
    const now = Date.now();
    try {
      await addDoc(collection(db, "projects"), {
        organization_id: profile.organization_id,
        project_name: name.trim(),
        project_description: desc.trim(),
        project_status: "ACTIVE",
        created_at: now,
        updated_at: now,
      });
      setName("");
      setDesc("");
      await load();
    } catch (error) {
      console.error("[ProjectsPage] 프로젝트 생성 실패:", error);
      setCreateError("프로젝트 생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setCreating(false);
    }
  }

  // 삭제 = 보관(archive): 프로젝트에는 이미 회의가 연결되어 있을 수 있으므로 문서를 실제로
  // 지우지 않고 project_status만 ARCHIVED로 바꿉니다(회사/부서/사용자 삭제와 동일한 원칙).
  // 언제든 "복원"으로 다시 활성화할 수 있습니다.
  async function setArchived(p: Project, archived: boolean) {
    try {
      await updateDoc(doc(db, "projects", p.id), {
        project_status: archived ? "ARCHIVED" : "ACTIVE",
        updated_at: Date.now(),
      });
      setConfirmArchiveId(null);
      await load();
    } catch (error) {
      console.error("[ProjectsPage] 프로젝트 상태 변경 실패:", error);
      alert("처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  const activeProjects = projects.filter((p) => p.project_status !== "ARCHIVED");
  const archivedProjects = projects.filter((p) => p.project_status === "ARCHIVED");

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold text-navy">프로젝트</h1>

        <form onSubmit={createProject} className="card mb-6 flex flex-col gap-3 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <input className="input md:col-span-1" placeholder="프로젝트명" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input md:col-span-2" placeholder="설명 (선택)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <button className="btn btn-primary self-start" disabled={creating || !name.trim()}>
            {creating ? "생성 중…" : "프로젝트 생성"}
          </button>
        </form>

        {loadError && <p className="card mb-4 p-4 text-sm text-red-600">{loadError}</p>}

        <div className="flex flex-col gap-2">
          {activeProjects.map((p) => (
            <div key={p.id} className="card flex items-center justify-between gap-3 p-4">
              <Link href={`/meetings/new?project=${p.id}`} className="min-w-0 flex-1 hover:opacity-80">
                <div className="font-medium text-ink">{p.project_name}</div>
                <div className="truncate text-sm text-gray-400">{p.project_description || "설명 없음"}</div>
              </Link>
              <div className="flex shrink-0 gap-2">
                <button className="btn btn-secondary text-xs" onClick={() => setEditingProject(p)}>수정</button>
                {confirmArchiveId === p.id ? (
                  <span className="flex items-center gap-1 text-xs">
                    보관할까요?
                    <button className="btn btn-accent text-xs" onClick={() => setArchived(p, true)}>예</button>
                    <button className="btn btn-secondary text-xs" onClick={() => setConfirmArchiveId(null)}>아니오</button>
                  </span>
                ) : (
                  <button className="btn btn-secondary text-xs" onClick={() => setConfirmArchiveId(p.id)}>삭제</button>
                )}
              </div>
            </div>
          ))}
          {!loadError && activeProjects.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">아직 프로젝트가 없습니다.</p>}
        </div>

        {archivedProjects.length > 0 && (
          <div className="mt-6">
            <button className="text-xs text-gray-400 underline" onClick={() => setShowArchived((v) => !v)}>
              보관된 프로젝트 {archivedProjects.length}개 {showArchived ? "숨기기" : "보기"}
            </button>
            {showArchived && (
              <div className="mt-2 flex flex-col gap-2">
                {archivedProjects.map((p) => (
                  <div key={p.id} className="card flex items-center justify-between gap-3 p-4 opacity-60">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink">{p.project_name}</div>
                      <div className="truncate text-sm text-gray-400">{p.project_description || "설명 없음"}</div>
                    </div>
                    <button className="btn btn-secondary shrink-0 text-xs" onClick={() => setArchived(p, false)}>복원</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {editingProject && (
          <ProjectModal
            project={editingProject}
            onClose={() => setEditingProject(null)}
            onDone={async () => { setEditingProject(null); await load(); }}
          />
        )}
      </main>
    </div>
  );
}

function ProjectModal({
  project,
  onClose,
  onDone,
}: {
  project: Project;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(project.project_name);
  const [desc, setDesc] = useState(project.project_description);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateDoc(doc(db, "projects", project.id), {
        project_name: name.trim(),
        project_description: desc.trim(),
        updated_at: Date.now(),
      });
      onDone();
    } catch (e) {
      console.error("[ProjectModal] 프로젝트 수정 실패:", e);
      setError("수정에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-sm p-6">
        <h3 className="mb-4 font-semibold text-ink">프로젝트 수정</h3>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">프로젝트명</label>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">설명</label>
            <input className="input w-full" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>취소</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim()}>저장</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <AuthGate>
      <ProjectsContent />
    </AuthGate>
  );
}
