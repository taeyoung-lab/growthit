"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import type { UserProfile } from "@/lib/types";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      // 로그인 직후 이 화면에서 프로필을 직접 한 번 조회해 이동 경로를 확정합니다.
      // (5장: must_change_password === true면 반드시 비밀번호 변경 화면으로 이동해야 함)
      //
      // 2026-09-09 재점검: 예전에는 클라이언트 Firestore SDK(getDoc)로 직접 조회했는데,
      // 로그인 직후에는 Firestore의 실시간 연결이 아직 자리잡기 전이라 "client is offline"
      // 오류로 이 조회 자체가 실패하는 경우가 실제로 재현되었고, 그 결과 must_change_password
      // 계정도 비밀번호 변경 화면으로 못 넘어가는 회귀가 있었습니다. Admin SDK 기반 서버
      // API(/api/auth/profile)는 클라이언트 네트워크 상태와 무관한 일반 HTTPS 요청이라 이
      // 문제 자체가 발생하지 않습니다. 그래도 일시적 네트워크 오류에 대비해 1회만 재시도합니다.
      let mustChangePassword = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const token = await cred.user.getIdToken();
          const res = await fetch("/api/auth/profile", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            mustChangePassword = Boolean((data.profile as UserProfile | null)?.must_change_password);
            break;
          }
          console.error(`[LoginPage] 로그인 직후 프로필 조회 실패(시도 ${attempt}/2): HTTP`, res.status);
        } catch (profileError) {
          console.error(`[LoginPage] 로그인 직후 프로필 조회 실패(시도 ${attempt}/2):`, profileError);
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      router.push(mustChangePassword ? "/change-password" : "/");
    } catch {
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm card p-8">
        <h1 className="mb-1 text-xl font-bold text-navy">그로스잇 회의록시스템</h1>
        <p className="mb-6 text-sm text-gray-500">관리자가 발급한 계정으로 로그인하세요.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">이메일</label>
            <input
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">비밀번호</label>
            <input
              type="password"
              required
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-2">
            {loading ? "로그인 중…" : "로그인"}
          </button>
        </form>
        <p className="mt-6 text-xs text-gray-400">
          계정이 없으신가요? 조직 관리자에게 이메일 등록을 요청하세요. (자체 회원가입 없음 — 기획서 5장)
        </p>
      </div>
    </div>
  );
}
