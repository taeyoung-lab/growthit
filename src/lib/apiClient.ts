"use client";

import { auth } from "@/lib/firebase/client";

/** 로그인된 사용자의 Firebase ID 토큰을 자동으로 담아 API 라우트를 호출합니다. */
export async function authedFetch(path: string, options: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const token = await user.getIdToken();

  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `요청이 실패했습니다 (${res.status})`);
  }
  return res.json();
}

/** 파일(바이너리)을 돌려주는 API용 — 인증 헤더를 붙여 호출하고 Blob과 파일명을 돌려줍니다. */
export async function authedFetchBlob(path: string, options: RequestInit = {}): Promise<{ blob: Blob; fileName: string | null }> {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `요청이 실패했습니다 (${res.status})`);
  }
  const raw = res.headers.get("X-File-Name");
  return { blob: await res.blob(), fileName: raw ? decodeURIComponent(raw) : null };
}
