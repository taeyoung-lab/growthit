"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addDoc, collection, getDocs, orderBy, query, where } from "firebase/firestore";
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

  async function load() {
    if (!profile) return;
    const snap = await getDocs(
      query(collection(db, "projects"), where("organization_id", "==", profile.organization_id), orderBy("created_at", "desc"))
    );
    setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Project)));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !name.trim()) return;
    setCreating(true);
    const now = Date.now();
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
    setCreating(false);
    load();
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
          <button className="btn btn-primary self-start" disabled={creating || !name.trim()}>
            프로젝트 생성
          </button>
        </form>

        <div className="flex flex-col gap-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/meetings/new?project=${p.id}`} className="card block p-4 hover:border-mint">
              <div className="font-medium text-ink">{p.project_name}</div>
              <div className="text-sm text-gray-400">{p.project_description || "설명 없음"}</div>
            </Link>
          ))}
          {projects.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">아직 프로젝트가 없습니다.</p>}
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
