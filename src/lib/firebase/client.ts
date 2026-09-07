"use client";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Next.js App Router는 "use client" 컴포넌트도 최초 1회 서버에서 렌더링합니다(SSR 프리렌더).
// 이 시점엔 브라우저 window가 없고 환경변수도 없을 수 있는데, firebase/auth의 getAuth()는
// API 키가 없으면 그 자리에서 바로 예외를 던져 빌드 자체가 실패합니다. 이 앱은 인증/DB를
// 전부 useEffect나 이벤트 핸들러(브라우저에서만 실행) 안에서만 사용하므로, 서버 렌더링 중에는
// 더미 객체를 내보내고 실제 초기화는 브라우저에서만 수행합니다.
export const firebaseApp: FirebaseApp | null =
  typeof window !== "undefined" ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null;

export const auth: Auth = firebaseApp ? getAuth(firebaseApp) : ({} as Auth);
export const db: Firestore = firebaseApp ? getFirestore(firebaseApp) : ({} as Firestore);
