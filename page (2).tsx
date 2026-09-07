"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

// 21~26장: 외부 공유 접속 화면. 로그인 없이 (1) URL 토큰 (2) 등록 이메일 (3) 임시 비밀번호를 검증합니다.
export default function ShareAccessPage({ params }: { params: { token: string } }) {
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
      const res = await fetch("/api/share/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share_token: params.token, email, temporary_password: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "인증에 실패했습니다.");

      await signInWithCustomToken(auth, data.custom_token);
      router.push(`/meetings/${data.meeting_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "인증에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm card p-8">
        <h1 className="mb-1 text-lg font-bold text-navy">공유 회의록 접속</h1>
        <p className="mb-6 text-sm text-gray-500">등록된 이메일과 전달받은 임시 비밀번호를 입력하세요.</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            required
            placeholder="이메일"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            required
            placeholder="임시 비밀번호"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value.toUpperCase())}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? "확인 중…" : "접속"}
          </button>
        </form>
      </div>
    </div>
  );
}
