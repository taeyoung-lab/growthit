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
