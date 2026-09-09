"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
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
          {projects.map((p) => (
            <Link key={p.id} href={`/meetings/new?project=${p.id}`} className="card block p-4 hover:border-mint">
              <div className="font-medium text-ink">{p.project_name}</div>
              <div className="text-sm text-gray-400">{p.project_description || "설명 없음"}</div>
            </Link>
          ))}
          {!loadError && projects.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">아직 프로젝트가 없습니다.</p>}
        </div>
      </main>
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
