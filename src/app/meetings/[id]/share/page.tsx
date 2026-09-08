"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { authedFetch } from "@/lib/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import { useDirectory } from "@/lib/firestore/useDirectory";
import type { MeetingShare } from "@/lib/types";

function ShareContent({ meetingId }: { meetingId: string }) {
  const { profile } = useAuth();
  const dir = useDirectory(profile?.organization_id);
  const [shares, setShares] = useState<MeetingShare[]>([]);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"VIEWER" | "PARTICIPANT">("VIEWER");
  const [result, setResult] = useState<{ share_url: string; temporary_password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadShares() {
    const snap = await getDocs(collection(db, "meetings", meetingId, "shares"));
    setShares(snap.docs.map((d) => d.data() as MeetingShare));
  }

  useEffect(() => {
    loadShares();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await authedFetch("/api/share/create", {
        method: "POST",
        body: JSON.stringify({ meeting_id: meetingId, target_email: email, permission }),
      });
      setResult(res);
      setEmail("");
      loadShares();
    } catch (e) {
      setError(e instanceof Error ? e.message : "공유 링크 생성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-6 text-xl font-bold text-navy">공유 관리</h1>

        <form onSubmit={handleShare} className="card mb-6 flex flex-col gap-3 p-5">
          <p className="text-sm text-gray-500">
            공유 대상은 반드시 등록된 사용자여야 합니다(23장). 등록되지 않은 이메일이면 먼저 관리자에게
            사용자 등록을 요청하세요.
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              required
              placeholder="공유 대상 이메일"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select className="input w-40" value={permission} onChange={(e) => setPermission(e.target.value as any)}>
              <option value="VIEWER">열람자 (읽기 전용)</option>
              <option value="PARTICIPANT">참여자 (편집 가능)</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn btn-primary self-start" disabled={submitting}>
            {submitting ? "생성 중…" : "공유 링크 생성"}
          </button>
        </form>

        {result && (
          <div className="card mb-6 border-mint p-5">
            <p className="mb-2 text-sm font-medium text-ink">
              생성 완료 — 아래 정보를 대상자에게 별도 채널(메신저 등)로 직접 전달하세요. 다시 확인할 수 없습니다.
            </p>
            <p className="text-sm">
              공유 URL: <code className="rounded bg-gray-100 px-1">{result.share_url}</code>
            </p>
            <p className="text-sm">
              임시 비밀번호: <code className="rounded bg-gray-100 px-1">{result.temporary_password}</code>
            </p>
          </div>
        )}

        <h2 className="mb-3 font-semibold text-ink">공유 목록</h2>
        <div className="flex flex-col gap-2">
          {shares.map((s) => (
            <div key={s.id} className="card flex items-center justify-between p-4 text-sm">
              <span>{dir.displayName(s.user_id)}</span>
              <span className="text-gray-400">{s.permission}</span>
              <span className={s.share_status === "ACTIVE" ? "text-emerald-600" : "text-gray-400"}>{s.share_status}</span>
            </div>
          ))}
          {shares.length === 0 && <p className="card p-6 text-center text-sm text-gray-400">공유 이력이 없습니다.</p>}
        </div>
      </main>
    </div>
  );
}

export default function SharePage({ params }: { params: { id: string } }) {
  return (
    <AuthGate>
      <ShareContent meetingId={params.id} />
    </AuthGate>
  );
}
