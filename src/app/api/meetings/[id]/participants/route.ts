import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireMeetingRole, ApiAuthError } from "@/lib/adminAuthCheck";
import { grantMeetingAccess, revokeMeetingAccess } from "@/lib/firebase/meetingAccess";
import type { MeetingRole } from "@/lib/types";

const VALID_ROLES: MeetingRole[] = ["AUTHOR", "PARTICIPANT", "VIEWER"];

/** 이 회의에 남은 편집자(AUTHOR)가 이 userId 한 명뿐인지 확인합니다.
 * 마지막 편집자를 실수로 강등/제외해서 아무도 편집할 수 없는 회의가 되는 것을 막기 위함입니다. */
async function isSoleAuthor(meetingId: string, userId: string): Promise<boolean> {
  const snap = await getAdminDb()
    .collection("meetings")
    .doc(meetingId)
    .collection("permissions")
    .where("role", "==", "AUTHOR")
    .get();
  const authorIds = snap.docs.map((d) => d.id);
  return authorIds.includes(userId) && authorIds.length <= 1;
}

// 회의록 단위 "참여자" 지정/역할 변경 — 편집자(AUTHOR)만 수행 가능.
// (사용자 요구사항: "참여자는 회의록에서 편집자가 지정하도록", "참여자를 편집자로 지정 가능하게")
// 이미 등록된 user_id로 다시 호출하면 grantMeetingAccess가 그대로 덮어쓰므로, 이 엔드포인트
// 하나로 "신규 추가"와 "기존 참여자 역할 변경"을 모두 처리합니다.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const meetingId = params.id;
  try {
    const { uid: authorUid } = await requireMeetingRole(req, meetingId, ["AUTHOR"]);
    const { user_id, role } = await req.json();
    if (!user_id) return NextResponse.json({ error: "user_id가 필요합니다." }, { status: 400 });
    const nextRole: MeetingRole = VALID_ROLES.includes(role) ? role : "PARTICIPANT";

    if (nextRole !== "AUTHOR" && (await isSoleAuthor(meetingId, user_id))) {
      return NextResponse.json(
        { error: "마지막 남은 편집자입니다. 다른 참여자를 먼저 편집자로 지정한 뒤 변경해주세요." },
        { status: 409 }
      );
    }

    await grantMeetingAccess({
      meetingId,
      userId: user_id,
      role: nextRole,
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

    if (await isSoleAuthor(meetingId, userId)) {
      return NextResponse.json(
        { error: "마지막 남은 편집자는 제외할 수 없습니다. 다른 참여자를 먼저 편집자로 지정해주세요." },
        { status: 409 }
      );
    }

    await revokeMeetingAccess({ meetingId, userId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "참여자 해제에 실패했습니다." }, { status: 500 });
  }
}
