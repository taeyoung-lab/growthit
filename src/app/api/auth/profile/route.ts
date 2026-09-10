import { NextRequest, NextResponse } from "next/server";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";

// 2026-09-09: 관리자 메뉴 미노출·프로젝트 생성 무반응·최초 로그인 비밀번호 변경 리다이렉트
// 실패가 전부 같은 원인이었습니다 — 클라이언트 Firestore SDK의 실시간 연결(WebChannel/
// 롱폴링)이 일부 네트워크에서 연결 자체를 못 맺거나 아주 오래 걸리면, 그 연결 상태에 묶여
// 있는 getDoc/onSnapshot 호출이 "클라이언트가 오프라인"이라며 즉시 실패해버립니다.
// (실시간 구독이 필요한 화면이 이 앱에는 사용자 프로필 하나뿐이라, 이 연결 하나 때문에
// 로그인 직후·모든 페이지 진입 시 프로필 로딩이 느려지거나 아예 실패하는 것이었습니다.)
//
// 그래서 로그인 직후/앱 진입 시 프로필 조회는 클라이언트 Firestore 실시간 연결에 기대지
// 않고, 이 서버 API(Admin SDK — 클라이언트 네트워크 상태와 무관하게 항상 빠르고 안정적인
// 일반 HTTPS 요청 1건)를 통해 가져옵니다.
//
// 2026-09-10: growthit-meetings 프로젝트 이전 후 500 에러 재현 — 원인 진단을 위해
// detail 필드를 임시로 추가함(민감정보 노출 없음, 원인 확인 후 제거 예정).
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireUser(req);
    return NextResponse.json({ profile });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[api/auth/profile] 조회 실패:", e);
    return NextResponse.json(
      { error: "프로필 조회에 실패했습니다.", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
