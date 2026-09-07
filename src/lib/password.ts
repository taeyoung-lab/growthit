import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// ============================================================================
// 공유 임시 비밀번호 유틸리티
//
// [기획서와 다르게 구현한 부분 — 검토 리포트의 "높음" 리스크 반영]
// 원 기획(24장)의 "wylie+회의일" 고정 규칙은 회의 날짜만 알면 누구나 유추할 수 있어
// 보안 계층으로서 의미가 없습니다. 대신 공유 대상자별로 서버가 무작위 6자리 코드를
// 발급하고, 평문은 절대 저장하지 않고 scrypt 해시만 저장합니다.
// ============================================================================

const TEMP_PASSWORD_LENGTH = 6;
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 혼동되는 0/O, 1/I 제외

export function generateTemporaryPassword(): string {
  const bytes = randomBytes(TEMP_PASSWORD_LENGTH);
  let out = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function hashTemporaryPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain.trim().toUpperCase(), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyTemporaryPassword(plain: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(plain.trim().toUpperCase(), salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
