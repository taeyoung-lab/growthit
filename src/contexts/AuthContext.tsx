"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
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
    let settled = false;
    const unsubProfile = onSnapshot(
      doc(db, "users", firebaseUser.uid),
      (snap) => {
        settled = true;
        setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
        setLoading(false);
      },
      (error) => {
        // 프로필 조회 실패(권한/네트워크 등) 시에도 무한 로딩에 빠지지 않도록 처리합니다.
        settled = true;
        console.error("[AuthContext] 사용자 프로필 조회 실패:", error);
        setProfile(null);
        setLoading(false);
      }
    );
    // 방어 코드: 네트워크 재연결 지연 등으로 실시간 구독(onSnapshot)이 성공도 실패도 아닌 채
    // 계속 응답하지 않는 경우(2026-09-09 재현 확인 — 관리자 메뉴 미노출·프로젝트 생성 무반응의
    // 실제 원인이었음), 5초 뒤에도 응답이 없으면 1회성 조회로 한 번 더 시도합니다.
    const fallbackTimer = setTimeout(async () => {
      if (settled) return;
      try {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (!settled) {
          setProfile(snap.exists() ? (snap.data() as UserProfile) : null);
          setLoading(false);
        }
      } catch (error) {
        console.error("[AuthContext] 사용자 프로필 폴백 조회 실패:", error);
        if (!settled) setLoading(false);
      }
    }, 5000);
    return () => {
      unsubProfile();
      clearTimeout(fallbackTimer);
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
