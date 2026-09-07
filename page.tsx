"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { authedFetch } from "@/lib/apiClient";
import type { Department, Organization, UserProfile } from "@/lib/types";

type Tab = "organizations" | "departments" | "users";

function AdminContent() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>("users");
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAll() {
    if (!profile) return;
    const [orgSnap, deptSnap, userSnap] = await Promise.all([
      getDocs(collection(db, "organizations")),
      getDocs(query(collection(db, "departments"), where("organization_id", "==", profile.organization_id))),
      getDocs(query(collection(db, "users"), where("organization_id", "==", profile.organization_id))),
    ]);
    setOrgs(orgSnap.docs.map((d) => d.data() as Organization));
    setDepts(deptSnap.docs.map((d) => d.data() as Department));
    setUsers(userSnap.docs.map((d) => d.data() as UserProfile));
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  if (profile && profile.org_role !== "ORG_ADMIN") {
    return (
      <div className="min-h-screen">
        <Navbar />
        <p className="p-8 text-center text-sm text-gray-400">조직 관리자만 접근할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold text-navy">관리자</h1>
        <div className="mb-6 flex gap-1 border-b border-gray-200">
          {([
            ["organizations", "회사"],
            ["departments", "부서"],
            ["users", "사용자"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium ${tab === k ? "border-b-2 border-navy text-navy" : "text-gray-400"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {message && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

        {tab === "organizations" && (
          <OrgTab orgs={orgs} onCreated={(name) => { setMessage(`"${name}" 회사가 생성되었습니다.`); loadAll(); }} />
        )}
        {tab === "departments" && (
          <DeptTab
            depts={depts}
            organizationId={profile!.organization_id}
            onCreated={(name) => { setMessage(`"${name}" 부서가 생성되었습니다.`); loadAll(); }}
          />
        )}
        {tab === "users" && (
          <UsersTab
            users={users}
            depts={depts}
            organizationId={profile!.organization_id}
            onCreated={(email, pw) => { setMessage(`${email} 계정 생성 완료. 초기 비밀번호: ${pw} (안전하게 전달하세요)`); loadAll(); }}
          />
        )}
      </main>
    </div>
  );
}

function OrgTab({ orgs, onCreated }: { orgs: Organization[]; onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await authedFetch("/api/admin/organizations", {
        method: "POST",
        body: JSON.stringify({ organization_name: name, organization_code: code }),
      });
      onCreated(name);
      setName("");
      setCode("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="card flex gap-2 p-4">
        <input className="input" placeholder="회사명 (예: 파트너사 A)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="input" placeholder="회사코드" value={code} onChange={(e) => setCode(e.target.value)} required />
        <button className="btn btn-primary" disabled={submitting}>추가</button>
      </form>
      <div className="flex flex-col gap-2">
        {orgs.map((o) => (
          <div key={o.id} className="card p-3 text-sm">{o.organization_name} <span className="text-gray-400">({o.organization_code})</span></div>
        ))}
      </div>
    </div>
  );
}

function DeptTab({
  depts,
  organizationId,
  onCreated,
}: {
  depts: Department[];
  organizationId: string;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [parent, setParent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await authedFetch("/api/admin/departments", {
        method: "POST",
        body: JSON.stringify({
          department_name: name,
          department_code: code,
          parent_department_id: parent || null,
          organization_id: organizationId,
        }),
      });
      onCreated(name);
      setName("");
      setCode("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="card flex flex-wrap gap-2 p-4">
        <input className="input" placeholder="부서명" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="input" placeholder="부서코드" value={code} onChange={(e) => setCode(e.target.value)} required />
        <select className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">상위 부서 없음</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>{d.department_name}</option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={submitting}>추가</button>
      </form>
      <div className="flex flex-col gap-2">
        {depts.map((d) => (
          <div key={d.id} className="card p-3 text-sm">{d.department_name} <span className="text-gray-400">({d.department_code})</span></div>
        ))}
      </div>
    </div>
  );
}

function UsersTab({
  users,
  depts,
  organizationId,
  onCreated,
}: {
  users: UserProfile[];
  depts: Department[];
  organizationId: string;
  onCreated: (email: string, pw: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [deptId, setDeptId] = useState("");
  const [orgRole, setOrgRole] = useState<"MEMBER" | "ORG_ADMIN">("MEMBER");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await authedFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          user_name: name,
          email,
          department_id: deptId || null,
          org_role: orgRole,
          organization_id: organizationId,
        }),
      });
      onCreated(email, res.initial_password);
      setName("");
      setEmail("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="card flex flex-wrap gap-2 p-4">
        <input className="input" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} required />
        <input className="input" type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select className="input" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
          <option value="">부서 없음</option>
          {depts.map((d) => (
            <option key={d.id} value={d.id}>{d.department_name}</option>
          ))}
        </select>
        <select className="input" value={orgRole} onChange={(e) => setOrgRole(e.target.value as any)}>
          <option value="MEMBER">일반 사용자</option>
          <option value="ORG_ADMIN">조직 관리자</option>
        </select>
        <button className="btn btn-primary" disabled={submitting}>계정 생성</button>
      </form>
      <div className="flex flex-col gap-2">
        {users.map((u) => (
          <div key={u.id} className="card flex justify-between p-3 text-sm">
            <span>{u.user_name} ({u.email})</span>
            <span className="text-gray-400">{u.org_role === "ORG_ADMIN" ? "관리자" : "일반"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AuthGate>
      <AdminContent />
    </AuthGate>
  );
}
