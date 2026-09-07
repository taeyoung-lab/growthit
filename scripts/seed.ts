/**
 * 최초 부트스트랩 스크립트.
 * 이 시스템은 자체 회원가입이 없고(5장), 관리자 API도 "이미 ORG_ADMIN이 있어야" 새 사용자를
 * 만들 수 있으므로, 맨 처음 회사/부서/최초 관리자 계정은 이 스크립트로 직접 생성합니다.
 *
 * 실행: npm run seed
 * 실행 전 .env.local에 Firebase Admin 환경변수(FIREBASE_PROJECT_ID 등)를 채워두세요.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as readline from "readline/promises";

async function prompt(rl: readline.Interface, question: string, fallback?: string) {
  const answer = await rl.question(`${question}${fallback ? ` (기본값: ${fallback})` : ""}: `);
  return answer.trim() || fallback || "";
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error("FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY 환경변수가 필요합니다.");
    process.exit(1);
  }

  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  const auth = getAuth();
  const db = getFirestore();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("=== 최초 회사 / 관리자 계정 생성 ===\n");

  const orgName = await prompt(rl, "회사명", "와일리");
  const orgCode = await prompt(rl, "회사코드", "WYLIE");
  const deptName = await prompt(rl, "관리자가 속할 부서명", "신성장사업본부");
  const deptCode = await prompt(rl, "부서코드", "NGB");
  const adminName = await prompt(rl, "관리자 이름");
  const adminEmail = await prompt(rl, "관리자 이메일");
  const adminPassword = await prompt(rl, "관리자 초기 비밀번호 (8자 이상)");
  rl.close();

  if (!adminName || !adminEmail || adminPassword.length < 8) {
    console.error("관리자 이름/이메일/8자 이상 비밀번호는 필수입니다.");
    process.exit(1);
  }

  const now = Date.now();

  const orgRef = db.collection("organizations").doc();
  await orgRef.set({
    id: orgRef.id,
    organization_name: orgName,
    organization_code: orgCode,
    organization_status: "ACTIVE",
    created_at: now,
    updated_at: now,
  });

  const deptRef = db.collection("departments").doc();
  await deptRef.set({
    id: deptRef.id,
    organization_id: orgRef.id,
    parent_department_id: null,
    department_name: deptName,
    department_code: deptCode,
    department_status: "ACTIVE",
    created_at: now,
    updated_at: now,
  });

  const userRecord = await auth.createUser({
    email: adminEmail,
    password: adminPassword,
    displayName: adminName,
  });

  await db.collection("users").doc(userRecord.uid).set({
    id: userRecord.uid,
    organization_id: orgRef.id,
    department_id: deptRef.id,
    user_name: adminName,
    email: adminEmail,
    phone: null,
    org_role: "ORG_ADMIN",
    user_status: "ACTIVE",
    created_at: now,
    updated_at: now,
  });

  console.log("\n생성 완료!");
  console.log(`- 회사: ${orgName} (${orgRef.id})`);
  console.log(`- 부서: ${deptName} (${deptRef.id})`);
  console.log(`- 관리자 계정: ${adminEmail} / 방금 입력한 비밀번호로 로그인하세요.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
