import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { MeetingRole } from "@/lib/types";

/**
 * 회의 권한 부여 + member_uids 동기화를 한 번에 처리하는 서버 전용 헬퍼.
 *
 * Cloud Functions(syncMeetingMemberUids)를 쓰지 않기로 했기 때문에(2026-09-08, Spark 요금제 유지),
 * meetings/{id}/permissions/{uid}에 쓰기를 하는 모든 서버 코드는 이 헬퍼를 통해
 * meeting.member_uids도 함께 갱신해야 합니다. 그렇지 않으면 "내 회의 목록"(member_uids
 * array-contains 쿼리)에 새로 권한을 받은 사람이 나타나지 않는 버그가 생깁니다.
 */
export async function grantMeetingAccess(params: {
  meetingId: string;
  userId: string;
  role: MeetingRole;
  grantedByUserId: string;
}) {
  const { meetingId, userId, role, grantedByUserId } = params;
  const db = getAdminDb();
  const meetingRef = db.collection("meetings").doc(meetingId);
  const permissionRef = meetingRef.collection("permissions").doc(userId);

  const batch = db.batch();
  const now = Date.now();
  batch.set(permissionRef, {
    user_id: userId,
    role,
    granted_by_user_id: grantedByUserId,
    granted_at: now,
  });
  batch.update(meetingRef, { member_uids: FieldValue.arrayUnion(userId), updated_at: now });
  await batch.commit();
}

/** 회의 권한 회수 + member_uids 동기화 */
export async function revokeMeetingAccess(params: { meetingId: string; userId: string }) {
  const { meetingId, userId } = params;
  const db = getAdminDb();
  const meetingRef = db.collection("meetings").doc(meetingId);
  const permissionRef = meetingRef.collection("permissions").doc(userId);

  const batch = db.batch();
  batch.delete(permissionRef);
  batch.update(meetingRef, { member_uids: FieldValue.arrayRemove(userId), updated_at: Date.now() });
  await batch.commit();
}
