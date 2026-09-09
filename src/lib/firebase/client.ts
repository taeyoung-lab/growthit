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
// 무한 반복.)
//
// 2026-09-09 재점검: experimentalAutoDetectLongPolling은 "먼저 스트리밍 연결을 시도해보고
// 실패하면 롱폴링으로 전환"하는 방식이라, 이 환경에서는 전환되기까지 실제로 10~20회 이상의
// 503 재연결이 반복되는 것을 다시 확인했습니다. 이 반복 구간 동안 등록된 일부 onSnapshot
// 구독(특히 로그인 직후 붙는 사용자 프로필 구독)이 응답을 영영 받지 못하는 상태로 남는
// 현상까지 재현되어(관리자 메뉴 미노출·프로젝트 생성 무반응의 실제 원인), 감지 방식 대신
// 처음부터 무조건 롱폴링만 쓰도록 강제합니다(experimentalForceLongPolling). 스트리밍 시도 자체를
// 건너뛰므로 503 재연결 구간이 아예 발생하지 않습니다.
export const db: Firestore = firebaseApp
  ? initializeFirestore(firebaseApp, { experimentalForceLongPolling: true })
  : ({} as Firestore);
