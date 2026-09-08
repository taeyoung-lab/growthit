"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { authedFetch } from "@/lib/apiClient";
import type { Department, Organization, OrgRole, UserProfile } from "@/lib/types";

type Tab = "organizations" | "departments" | "users";

const ROLE_LABEL: Record<OrgRole, string> = {
  SUPER_ADMIN: "슈퍼 관리자",
  ADMIN: "관리자",
  USER: "사용자",
};

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

  // 관리 기능은 슈퍼 관리자 전용입니다. 관리자(ADMIN)는 전체 컨텐츠 열람만 가능합니다.
  if (profile && profile.org_role !== "SUPER_ADMIN") {
    return (
      <div className="min-h-screen">
        <Navbar />
        <p className="p-8 text-center text-sm text-gray-400">슈퍼 관리자만 접근할 수 있습니다.</p>
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
            myUid={profile!.id}
            setMessage={setMessage}
            reload={loadAll}
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
  myUid,
  setMessage,
  reload,
}: {
  users: UserProfile[];
  depts: Department[];
  organizationId: string;
  myUid: string;
  setMessage: (m: string | null) => void;
  reload: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);

  const deptName = (id: string | null) => depts.find((d) => d.id === id)?.department_name || "-";

  async function handleDelete(uid: string) {
    try {
      await authedFetch(`/api/admin/users?uid=${uid}`, { method: "DELETE" });
      setMessage("계정이 비활성화되었습니다. 기존 회의·문답 데이터는 그대로 보존됩니다.");
      setConfirmDeleteUid(null);
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ 인원 생성</button>
      </div>

      <div className="flex flex-col gap-2">
        {users.map((u) => (
          <div key={u.id} className={`card flex items-center justify-between p-3 text-sm ${u.user_status === "INACTIVE" ? "opacity-50" : ""}`}>
            <div>
              <div className="font-medium text-ink">
                {u.user_name} <span className="text-gray-400">({u.email})</span>
                {u.user_status === "INACTIVE" && <span className="badge b-overdue ml-2">비활성</span>}
                {u.must_change_password && u.user_status === "ACTIVE" && (
                  <span className="badge b-pending ml-2">최초 비밀번호 변경 대기</span>
                )}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {deptName(u.department_id)} · {ROLE_LABEL[u.org_role]}
              </div>
            </div>
            <div className="flex gap-2">
              {u.user_status === "ACTIVE" && (
                <>
                  <button className="btn btn-secondary text-xs" onClick={() => setEditingUid(u.id)}>수정</button>
                  {u.id !== myUid && (
                    confirmDeleteUid === u.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        정말 삭제할까요?
                        <button className="btn btn-accent text-xs" onClick={() => handleDelete(u.id)}>예</button>
                        <button className="btn btn-secondary text-xs" onClick={() => setConfirmDeleteUid(null)}>아니오</button>
                      </span>
                    ) : (
                      <button className="btn btn-secondary text-xs" onClick={() => setConfirmDeleteUid(u.id)}>삭제</button>
                    )
                  )}
                </>
              )}
              {u.user_status === "INACTIVE" && (
                <span className="text-xs text-gray-400">삭제됨 · 기존 데이터 보존</span>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">등록된 인원이 없습니다.</p>}
      </div>

      {showCreate && (
        <UserModal
          mode="create"
          depts={depts}
          organizationId={organizationId}
          onClose={() => setShowCreate(false)}
          onDone={(msg) => { setMessage(msg); setShowCreate(false); reload(); }}
        />
      )}
      {editingUid && (
        <UserModal
          mode="edit"
          depts={depts}
          organizationId={organizationId}
          user={users.find((u) => u.id === editingUid)!}
          onClose={() => setEditingUid(null)}
          onDone={(msg) => { setMessage(msg); setEditingUid(null); reload(); }}
        />
      )}
    </div>
  );
}

function UserModal({
  mode,
  depts,
  organizationId,
  user,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  depts: Department[];
  organizationId: string;
  user?: UserProfile;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(user?.user_name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [deptId, setDeptId] = useState(user?.department_id || "");
  const [role, setRole] = useState<OrgRole>(user?.org_role || "USER");
  const [submitting, setSubmitting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "create") {
        await authedFetch("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            user_name: name,
            email,
            department_id: deptId || null,
            org_role: role,
            organization_id: organizationId,
          }),
        });
        onDone(`${email} 계정이 생성되었습니다. 초기 비밀번호는 1234이며, 최초 로그인 시 변경이 필요합니다.`);
      } else {
        await authedFetch("/api/admin/users", {
          method: "PATCH",
          body: JSON.stringify({
            uid: user!.id,
            user_name: name,
            department_id: deptId || null,
            org_role: role,
          }),
        });
        onDone(`${email} 계정 정보가 수정되었습니다.`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "실패");
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword() {
    if (!user) return;
    if (!confirm(`${user.email}의 비밀번호를 초기값(1234)으로 되돌릴까요?`)) return;
    try {
      await authedFetch("/api/admin/users", {
        method: "PATCH",
        body: JSON.stringify({ uid: user.id, reset_password: true }),
      });
      setResetMsg("비밀번호가 1234로 초기화되었습니다. 다음 로그인 시 재설정이 다시 요구됩니다.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "비밀번호 리셋 실패");
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-sm p-6">
        <h3 className="mb-4 font-semibold text-ink">{mode === "create" ? "인원 생성" : "인원 정보 수정"}</h3>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">이름</label>
            <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">이메일</label>
            <input
              className="input w-full"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={mode === "edit"}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">부서</label>
            <select className="input w-full" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">부서 없음</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.department_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">권한</label>
            <select className="input w-full" value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
              <option value="USER">사용자 (회의록 단위로 편집자/참여자 권한 부여)</option>
              <option value="ADMIN">관리자 (전체 컨텐츠 열람)</option>
              <option value="SUPER_ADMIN">슈퍼 관리자 (모든 기능 + 관리 기능)</option>
            </select>
          </div>

          {mode === "create" && (
            <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
              초기 비밀번호는 <span className="font-mono font-medium">1234</span>로 고정 발급되며,
              최초 로그인 시 비밀번호를 새로 설정해야 합니다(2회 입력 확인).
            </p>
          )}
          {mode === "edit" && (
            <div className="rounded-lg bg-gray-50 p-3">
              <button type="button" className="btn btn-secondary text-xs" onClick={resetPassword}>
                비밀번호 리셋 (1234로 초기화)
              </button>
              {resetMsg && <p className="mt-2 text-xs text-emerald-700">{resetMsg}</p>}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>취소</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {mode === "create" ? "생성" : "저장"}
            </button>
          </div>
        </form>
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
