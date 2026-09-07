import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireMeetingRole, ApiAuthError } from "@/lib/adminAuthCheck";
import { generateTemporaryPassword, hashTemporaryPassword } from "@/lib/password";
import { randomBytes } from "crypto";

const DEFAULT_EXPIRES_DAYS = 14;

// 21~26장: 공유 URL 발급. AUTHOR만 수행 가능.
// 대상은 반드시 이메일이 등록된 기존 시스템 사용자여야 합니다 (23장).
export async function POST(req: NextRequest, { params }: { params: Record<string, never> }) {
  try {
    const body = await req.json();
    const { meeting_id, target_email, permission, expires_in_days } = body;
    if (!meeting_id || !target_email) {
      return NextResponse.json({ error: "meeting_id와 target_email은 필수입니다." }, { status: 400 });
    }

    const { uid: authorUid } = await requireMeetingRole(req, meeting_id, ["AUTHOR"]);

    const userQuery = await getAdminDb()
      .collection("users")
      .where("email", "==", target_email.trim().toLowerCase())
      .limit(1)
      .get();
    if (userQuery.empty) {
      return NextResponse.json(
        { error: "등록된 이메일이 아닙니다. 먼저 회원(사용자)으로 등록해야 공유할 수 있습니다." },
        { status: 400 }
      );
    }
    const targetUser = userQuery.docs[0];

    const shareToken = randomBytes(16).toString("hex");
    const temporaryPassword = generateTemporaryPassword();
    const now = Date.now();
    const expiresAt = now + (expires_in_days || DEFAULT_EXPIRES_DAYS) * 24 * 60 * 60 * 1000;
    const sharePermission = permission === "PARTICIPANT" ? "PARTICIPANT" : "VIEWER";

    const shareRef = getAdminDb().collection("meetings").doc(meeting_id).collection("shares").doc();
    await shareRef.set({
      id: shareRef.id,
      meeting_id,
      user_id: targetUser.id,
      share_token: shareToken,
      permission: sharePermission,
      share_status: "ACTIVE",
      temporary_password_hash: hashTemporaryPassword(temporaryPassword),
      expires_at: expiresAt,
      created_by_user_id: authorUid,
      created_at: now,
      updated_at: now,
    });

    // 공유 대상에게 즉시 회의 접근 권한 부여 (permissions 서브컬렉션)
    await getAdminDb()
      .collection("meetings")
      .doc(meeting_id)
      .collection("permissions")
      .doc(targetUser.id)
      .set({
        user_id: targetUser.id,
        role: sharePermission,
        granted_by_user_id: authorUid,
        granted_at: now,
      });

    const baseUrl = process.env.NEXT_PUBLIC_APP_BASE_URL || "http://localhost:3000";
    return NextResponse.json({
      share_url: `${baseUrl}/share/${shareToken}`,
      // 평문 임시 비밀번호는 이 응답에서만 노출됩니다 — 서버에 저장되지 않으므로
      // 반드시 이 화면에서 복사해 대상자에게 별도 채널(메신저 등)로 전달하세요.
      temporary_password: temporaryPassword,
      expires_at: expiresAt,
    });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "공유 링크 생성에 실패했습니다." }, { status: 500 });
  }
}
