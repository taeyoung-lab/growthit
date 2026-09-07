"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/** 로그인하지 않은 사용자를 /login으로 보냅니다. 보호가 필요한 페이지에서 감싸 사용하세요. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { firebaseUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !firebaseUser) router.replace("/login");
  }, [loading, firebaseUser, router]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-gray-500">불러오는 중…</div>;
  }
  if (!firebaseUser) return null;
  return <>{children}</>;
}
