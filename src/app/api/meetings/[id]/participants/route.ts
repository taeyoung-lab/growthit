import { NextRequest, NextResponse } from "next/server";
import { requireMeetingRole, ApiAuthError } from "@/lib/adminAuthCheck";
import { grantMeetingAccess, revokeMeetingAccess } from "@/lib/firebase/meetingAccess";

// 회의록 단위 "참여자" 지정 — 편집자(AUTHOR)만 수행 가능.
// (사용자 요구사항: "참여자는 회의록에서 편집자가 지정하도록")
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const meetingId = params.id;
  try {
    const { uid: authorUid } = await requireMeetingRole(req, meetingId, ["AUTHOR"]);
    const { user_id } = await req.json();
    if (!user_id) return NextResponse.json({ error: "user_id가 필요합니다." }, { status: 400 });

    await grantMeetingAccess({
      meetingId,
      userId: user_id,
      role: "PARTICIPANT",
      grantedByUserId: authorUid,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "참여자 지정에 실패했습니다." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const meetingId = params.id;
  try {
    await requireMeetingRole(req, meetingId, ["AUTHOR"]);
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("user_id");
    if (!userId) return NextResponse.json({ error: "user_id가 필요합니다." }, { status: 400 });

    await revokeMeetingAccess({ meetingId, userId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "참여자 해제에 실패했습니다." }, { status: 500 });
  }
}
