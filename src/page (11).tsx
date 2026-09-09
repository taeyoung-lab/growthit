"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
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
      // AuthContext의 onSnapshot 구독이 새 페이지에서 다시 붙는 타이밍에 의존하지 않도록,
      // 로그인 직후 이 화면에서 프로필을 직접 한 번 조회해 이동 경로를 확정합니다.
      // (5장: must_change_password === true면 반드시 비밀번호 변경 화면으로 이동해야 함)
      let mustChangePassword = false;
      try {
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        mustChangePassword = snap.exists() ? Boolean((snap.data() as UserProfile).must_change_password) : false;
      } catch (profileError) {
        console.error("[LoginPage] 로그인 직후 프로필 조회 실패:", profileError);
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
