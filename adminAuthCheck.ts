import { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import type { UserProfile } from "@/lib/types";

export class ApiAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** Authorization: Bearer <Firebase ID Token> 헤더를 검증하고 사용자 프로필을 반환합니다. */
export async function requireUser(req: NextRequest): Promise<{ uid: string; profile: UserProfile }> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new ApiAuthError("로그인이 필요합니다.", 401);

  const decoded = await getAdminAuth().verifyIdToken(token).catch(() => null);
  if (!decoded) throw new ApiAuthError("인증 토큰이 유효하지 않습니다.", 401);

  const snap = await getAdminDb().collection("users").doc(decoded.uid).get();
  if (!snap.exists) throw new ApiAuthError("사용자 프로필을 찾을 수 없습니다.", 404);

  return { uid: decoded.uid, profile: snap.data() as UserProfile };
}

export async function requireOrgAdmin(req: NextRequest) {
  const { uid, profile } = await requireUser(req);
  if (profile.org_role !== "ORG_ADMIN") {
    throw new ApiAuthError("조직 관리자만 수행할 수 있는 작업입니다.", 403);
  }
  return { uid, profile };
}

/** meetings/{meetingId}/permissions/{uid} 문서를 확인해 회의 접근 권한을 검사합니다. */
export async function requireMeetingRole(
  req: NextRequest,
  meetingId: string,
  allowedRoles: Array<"AUTHOR" | "PARTICIPANT" | "VIEWER">
) {
  const { uid, profile } = await requireUser(req);
  const permSnap = await getAdminDb()
    .collection("meetings")
    .doc(meetingId)
    .collection("permissions")
    .doc(uid)
    .get();

  if (!permSnap.exists || !allowedRoles.includes(permSnap.data()?.role)) {
    throw new ApiAuthError("이 회의에 대한 권한이 없습니다.", 403);
  }
  return { uid, profile, role: permSnap.data()?.role as string };
}
