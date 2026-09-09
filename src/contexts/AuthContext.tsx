"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import type { UserProfile } from "@/lib/types";

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  profile: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;

    // 2026-09-09 재점검: 원래 이 프로필은 Firestore 실시간 구독(onSnapshot)으로 가져왔는데,
    // 이 앱 전체를 통틀어 실시간 구독이 필요한 화면이 사실상 이것 하나뿐이었습니다. 그런데
    // 이 구독 하나 때문에 매 페이지 진입마다 Firestore의 WebChannel 연결(브라우저-Firestore
    // 간 오래 유지되는 연결)을 새로 맺어야 했고, 일부 네트워크(사내망/프록시/보안 프로그램
    // 등)에서 이 연결이 계속 503으로 끊기고 재연결을 반복하면서 — 심하면 수십 초가 지나도
    // 응답을 못 받는 것을 실제로 재현 확인했습니다. 그 결과가 바로 관리자 메뉴 미노출,
    // 프로젝트 생성 무반응, 최초 로그인 비밀번호 변경 리다이렉트 실패였습니다.
    // 실시간으로 계속 갱신될 필요는 없는 값이므로(다른 관리자가 내 권한을 바꾸면 재로그인/
    // 새로고침 시 반영되는 정도면 충분), Admin SDK 기반 서버 API로 1회 조회하는 방식으로
    // 바꿔 이 연결 자체에 더 이상 의존하지 않도록 했습니다 — 일반 HTTPS 요청 1건이라
    // 훨씬 빠르고, 위 네트워크 문제의 영향을 받지 않습니다.
    async function loadProfile() {
      try {
        const token = await firebaseUser!.getIdToken();
        const res = await fetch("/api/auth/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setProfile(data.profile ?? null);
        } else {
          console.error("[AuthContext] 사용자 프로필 조회 실패: HTTP", res.status);
          setProfile(null);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[AuthContext] 사용자 프로필 조회 실패:", error);
          setProfile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    setLoading(true);
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  return (
    <AuthContext.Provider value={{ firebaseUser, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
