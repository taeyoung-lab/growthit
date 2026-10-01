import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ============================================================================
// CMS 로그인 자격증명 암호화 유틸리티 — 서버 전용 모듈입니다.
// 클라이언트 컴포넌트에서 절대 import하지 마세요(src/app/api/brands 등 API Route에서만 사용).
//
// src/lib/password.ts(scrypt 단방향 해시)와는 용도가 다릅니다 — CMS 자동 로그인 시 서버가
// 원문 비밀번호를 다시 읽어야 하므로(단방향 해시로는 불가능) AES-256-GCM으로 복호화 가능하게
// 암호화합니다. 암호화 키는 CMS_CREDENTIALS_ENC_KEY 환경변수(32바이트를 base64로 인코딩한 값)로만
// 보관하고, 저장된 값(brandCredentials 컬렉션)은 firestore.rules로 클라이언트 접근을 전면 차단합니다.
// ============================================================================

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM 권장 길이

function getKey(): Buffer {
  const raw = process.env.CMS_CREDENTIALS_ENC_KEY;
  if (!raw) {
    throw new Error(
      "CMS_CREDENTIALS_ENC_KEY 환경변수가 설정되지 않았습니다. 32바이트를 base64로 인코딩한 값을 " +
        ".env.local / Vercel 환경변수에 등록하세요 (예: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\")."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CMS_CREDENTIALS_ENC_KEY는 반드시 32바이트(base64 인코딩 기준 44자)여야 합니다.");
  }
  return key;
}

/** 평문 CMS 비밀번호를 암호화합니다. 저장 형식: base64(iv):base64(authTag):base64(ciphertext) */
export function encryptCmsPassword(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** encryptCmsPassword로 저장된 값을 평문으로 복호화합니다(자동 로그인 실행 시에만 사용). */
export function decryptCmsPassword(stored: string): string {
  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = stored.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("저장된 CMS 비밀번호 형식이 올바르지 않습니다.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plain.toString("utf8");
}

