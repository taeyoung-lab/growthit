import { createHmac, timingSafeEqual } from "crypto";

// ============================================================================
// 공유 링크 "페이지 제한" 접근 증명 (proof) 유틸리티
//
// [배경] 기존 구현은 공유 링크 접속 시 대상자의 실제 Firebase 계정으로 로그인시켜서
// (signInWithCustomToken) /meetings/{id}로 보냈습니다. 문제는 그 순간부터 그 사람은
// "진짜 로그인한 자기 계정"이 되어 버려서, 앱의 다른 페이지(프로젝트 목록 등)도 자기
// 권한(org_role)만큼 볼 수 있게 됩니다 — "공유 링크를 가진 사람은 그 회의록 한 페이지만
// 봐야 한다"는 요구사항에 맞지 않습니다.
//
// [해결] 공유 링크 접속은 이제 Firebase Auth 로그인을 전혀 하지 않습니다. 대신 이메일 +
// 임시 비밀번호 검증에 성공하면, 그 공유 건(share 문서)에만 묶인 서명된 증명값(proof)을
// 발급합니다. 이 proof는 오직 "이 공유 문서의 읽기 전용 콘텐츠 API"에만 사용할 수 있고,
// Firestore 보안규칙이나 다른 API에는 전혀 통하지 않습니다 — 즉 다른 페이지로 이동할
// "계정"자체가 없으므로 구조적으로 다른 페이지를 볼 수 없습니다.
// ============================================================================

function secret(): string {
  // 별도의 SHARE_SESSION_SECRET 환경변수를 추가하면 그것을 우선 사용합니다.
  // 아직 추가하지 않았다면(Vercel 환경변수 설정은 별도 작업이 필요하므로) 이미 서버에
  // 설정되어 있는 Firebase Admin 비밀키를 대신 사용해 추가 배포 설정 없이 바로 동작합니다.
  return (
    process.env.SHARE_SESSION_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY ||
    "growthit-share-proof-fallback-secret-change-me"
  );
}

export function createShareProof(shareId: string, expiresAt: number): string {
  const payload = `${shareId}.${expiresAt}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`, "utf8").toString("base64url");
}

export function verifyShareProof(proof: string | null | undefined, shareId: string, expiresAt: number): boolean {
  if (!proof) return false;
  try {
    const decoded = Buffer.from(proof, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return false;
    const [pShareId, pExpiresAtStr, pSig] = parts;
    if (pShareId !== shareId) return false;
    if (String(expiresAt) !== pExpiresAtStr) return false;

    const expectedPayload = `${pShareId}.${pExpiresAtStr}`;
    const expectedSig = createHmac("sha256", secret()).update(expectedPayload).digest("hex");
    const a = Buffer.from(pSig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
