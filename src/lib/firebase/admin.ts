import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// 서버 전용 모듈입니다. 클라이언트 컴포넌트에서 절대 import하지 마세요.
// (Next.js API Route / Server Action / Cloud Functions 에서만 사용)
//
// 지연 초기화(lazy init)로 구현한 이유: 이 모듈을 최상위에서 바로 초기화하면
// `next build` 가 라우트 모듈을 로드하는 시점에 환경변수 검증이 실행되어,
// 로컬에 .env.local이 아직 없을 때 빌드 자체가 실패합니다. 실제 요청이 들어와
// 함수가 호출되는 시점에만 초기화하도록 미룹니다.

let app: App | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function getAdminApp(): App {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0];
    return app;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // .env 파일에 개행이 \n 문자열로 저장되므로 실제 개행으로 치환
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin 서비스 계정 환경변수가 설정되지 않았습니다. .env.local의 " +
        "FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY를 확인하세요."
    );
  }

  app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return app;
}

export function getAdminAuth(): Auth {
  if (!authInstance) authInstance = getAuth(getAdminApp());
  return authInstance;
}

export function getAdminDb(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(getAdminApp());
  return dbInstance;
}
