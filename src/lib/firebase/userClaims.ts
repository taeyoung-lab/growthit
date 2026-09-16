import { getAdminAuth } from "@/lib/firebase/admin";
import type { OrgRole } from "@/lib/types";

/**
 * Firebase Auth 커스텀 클레임에 org_role / organization_id를 동기화하는 서버 전용 헬퍼.
 *
 * 2026-09-16: Firestore 보안 규칙에서 "SUPER_ADMIN/ADMIN은 전체 컨텐츠 열람 가능"을 판단할 때
 * get(/databases/.../users/{request.auth.uid}).data.org_role 처럼 다른 문서를 조회하는 방식은
 * 단일 문서 조회(get)에서는 정상 동작하지만, LIST 쿼리(where+orderBy로 여러 문서를 한 번에
 * 조회하는 것 — 예: 메인 대시보드의 회의/질의/향후추진과제 목록)에서는 Firestore가 이 조회를
 * 신뢰하지 못해 전체 쿼리를 거부하는 문제를 반복적으로 겪었습니다(회사/부서/사용자/프로젝트에서
 * 이미 한 번, 이번엔 회의/질의/향후추진과제 전체에서 재현).
 *
 * 해결책: org_role/organization_id를 Firestore 문서가 아니라 로그인 토큰(ID Token)의 커스텀
 * 클레임에 실어서, 규칙에서는 request.auth.token.org_role 처럼 "다른 문서를 전혀 조회하지 않고"
 * 바로 확인할 수 있게 합니다. 이러면 LIST 쿼리에서도 100% 안전하게 동작합니다.
 *
 * 클레임은 사용자 생성/권한변경 시점에 이 함수로 갱신하고, 클라이언트는 로그인 직후
 * getIdToken(true)로 강제 새로고침해서 최신 클레임을 즉시 반영합니다(AuthContext 참고).
 */
export async function syncUserClaims(uid: string, params: { org_role: OrgRole; organization_id: string }) {
  await getAdminAuth().setCustomUserClaims(uid, {
    org_role: params.org_role,
    organization_id: params.organization_id,
  });
}
