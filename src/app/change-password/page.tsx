"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { AuthGate } from "@/components/AuthGate";
import { authedFetch } from "@/lib/apiClient";

// 5장: 초기 비밀번호(123456)로 로그인한 사용자는 최초 접속 시 반드시 이 화면에서
// 새 비밀번호를 설정해야 합니다 (2회 입력으로 확인).
function ChangePasswordContent() {
  const [pw, setPw] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const mismatch = pwConfirm.length > 0 && pw !== pwConfirm;
  const tooShort = pw.length > 0 && pw.length < 8;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) return setError("비밀번호는 8자 이상이어야 합니다.");
    if (pw !== pwConfirm) return setError("비밀번호가 일치하지 않습니다.");
    if (pw === "123456") return setError("초기 비밀번호와 다른 비밀번호로 설정해주세요.");

    setSubmitting(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("로그인이 필요합니다.");
      await updatePassword(user, pw);
      await authedFetch("/api/account/mark-password-changed", { method: "POST" });
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "비밀번호 변경에 실패했습니다. 다시 로그인 후 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm card p-8">
        <h1 className="mb-1 text-xl font-bold text-navy">비밀번호 설정</h1>
        <p className="mb-6 text-sm text-gray-500">
          초기 비밀번호(123456)로 로그인하셨습니다. 계속 진행하려면 새 비밀번호를 설정해주세요.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">새 비밀번호 (8자 이상)</label>
            <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">새 비밀번호 확인</label>
            <input
              type="password"
              className="input"
              value={pwConfirm}
              onChange={(e) => setPwConfirm(e.target.value)}
              required
            />
            {mismatch && <p className="mt-1 text-xs text-red-600">비밀번호가 일치하지 않습니다.</p>}
            {!mismatch && tooShort && <p className="mt-1 text-xs text-red-600">8자 이상 입력해주세요.</p>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={submitting} className="btn btn-primary mt-2">
            {submitting ? "설정 중…" : "비밀번호 설정하고 계속하기"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <AuthGate>
      <ChangePasswordContent />
    </AuthGate>
  );
}
