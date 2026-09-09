import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifyTemporaryPassword } from "@/lib/password";
import { createShareProof } from "@/lib/shareProof";

// 21~26장: 공유 URL 접속 검증. 인증되지 않은 외부 접근이므로 별도 로그인 없이
// (1) URL의 share_token (2) 등록 이메일 (3) 임시 비밀번호 를 모두 검증합니다.
//
// 통과해도 더 이상 대상자의 실제 Firebase 계정으로 로그인시키지 않습니다(이전에는
// signInWithCustomToken으로 실제 계정에 로그인시켜서, 그 사람이 앱의 다른 페이지도
// 자기 권한만큼 열람할 수 있는 문제가 있었습니다 — "링크를 가진 사람은 그 회의록
// 한 페이지만 봐야 한다"는 요구사항 위반). 대신 "이 공유 건의 읽기 전용 콘텐츠
// API"에서만 통하는 proof를 발급해, 딱 그 페이지만 보이도록 합니다.
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

  const proof = createShareProof(shareDoc.id, share.expires_at);

  return NextResponse.json({
    proof,
    meeting_id: meetingId,
    share_token: share_token,
    permission: share.permission,
  });
}
