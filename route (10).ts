import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { verifyTemporaryPassword } from "@/lib/password";

// 21~26장: 공유 URL 접속 검증. 인증되지 않은 외부 접근이므로 별도 로그인 없이
// (1) URL의 share_token (2) 등록 이메일 (3) 임시 비밀번호 를 모두 검증합니다.
// 통과하면 해당 사용자 계정으로 로그인할 수 있는 Firebase 커스텀 토큰을 발급합니다.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { share_token, email, temporary_password } = body;
  const ip = req.headers.get("x-forwarded-for") || null;
  const userAgent = req.headers.get("user-agent") || null;

  if (!share_token || !email || !temporary_password) {
    return NextResponse.json({ error: "필수 입력값이 누락되었습니다." }, { status: 400 });
  }

  const shareQuery = await getAdminDb()
    .collectionGroup("shares")
    .where("share_token", "==", share_token)
    .limit(1)
    .get();

  const logAccess = async (
    result: "SUCCESS" | "FAILURE" | "EXPIRED" | "REVOKED",
    meetingId: string | null,
    shareId: string | null,
    userId: string | null
  ) => {
    await getAdminDb().collection("meetingShareAccessLogs").add({
      meeting_id: meetingId,
      share_id: shareId,
      user_id: userId,
      email: email.trim().toLowerCase(),
      access_result: result,
      accessed_at: Date.now(),
      ip_address: ip,
      user_agent: userAgent,
    });
  };

  if (shareQuery.empty) {
    await logAccess("FAILURE", null, null, null);
    return NextResponse.json({ error: "유효하지 않은 공유 링크입니다." }, { status: 404 });
  }

  const shareDoc = shareQuery.docs[0];
  const share = shareDoc.data();
  const meetingId = share.meeting_id as string;

  if (share.share_status === "REVOKED") {
    await logAccess("REVOKED", meetingId, shareDoc.id, null);
    return NextResponse.json({ error: "공유가 취소되었습니다." }, { status: 403 });
  }
  if (share.share_status !== "ACTIVE" || share.expires_at < Date.now()) {
    await logAccess("EXPIRED", meetingId, shareDoc.id, null);
    return NextResponse.json({ error: "공유 기간이 만료되었습니다." }, { status: 403 });
  }

  const userSnap = await getAdminDb().collection("users").doc(share.user_id).get();
  const user = userSnap.data();
  if (!user || user.email.toLowerCase() !== email.trim().toLowerCase()) {
    await logAccess("FAILURE", meetingId, shareDoc.id, null);
    return NextResponse.json({ error: "등록된 공유 대상 이메일이 아닙니다." }, { status: 403 });
  }

  if (!verifyTemporaryPassword(temporary_password, share.temporary_password_hash)) {
    await logAccess("FAILURE", meetingId, shareDoc.id, user.id);
    return NextResponse.json({ error: "임시 비밀번호가 올바르지 않습니다." }, { status: 403 });
  }

  await logAccess("SUCCESS", meetingId, shareDoc.id, user.id);

  const customToken = await getAdminAuth().createCustomToken(user.id, {
    sharedMeetingId: meetingId,
  });

  return NextResponse.json({ custom_token: customToken, meeting_id: meetingId });
}
