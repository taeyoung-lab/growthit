"use client";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { initializeFirestore, type Firestore } from "firebase/firestore";

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

// 회사/방화벽 프록시 등 일부 네트워크에서는 Firestore의 기본 실시간 연결(WebChannel 스트리밍)이
// 계속 503으로 끊기고 재연결을 반복하면서 onSnapshot이 영영 데이터를 못 받는 경우가 있습니다.
// (관리자 메뉴가 안 보이거나 최초 로그인 후 비밀번호 변경 화면으로 안 넘어가던 문제가 실제로
// 이 증상이었음을 크롬에서 재현 확인함 — Listen 채널이 POST 200 → GET 503 → terminate를
// 무한 반복.) experimentalAutoDetectLongPolling으로 초기화하면 SDK가 이런 환경을 자동 감지해서
// 롱폴링 방식으로 자동 전환하므로, 이 재연결 반복 문제를 피할 수 있습니다.
export const db: Firestore = firebaseApp
  ? initializeFirestore(firebaseApp, { experimentalAutoDetectLongPolling: true })
  : ({} as Firestore);
