"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/**
 * 로그인하지 않은 사용자를 /login으로 보냅니다. 보호가 필요한 페이지에서 감싸 사용하세요.
 * 또한 최초 로그인 시(must_change_password === true) /change-password로 강제 이동시킵니다
 * (5장: 초기 비밀번호 1234 → 최초 접속 시 비밀번호 재설정 필수).
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { firebaseUser, profile, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace("/login");
      return;
    }
    if (profile?.must_change_password && pathname !== "/change-password") {
      router.replace("/change-password");
    }
  }, [loading, firebaseUser, profile, pathname, router]);

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-gray-500">불러오는 중…</div>;
  }
  if (!firebaseUser) return null;
  if (profile?.must_change_password && pathname !== "/change-password") return null;
  return <>{children}</>;
}
