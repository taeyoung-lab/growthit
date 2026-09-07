import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onDocumentWritten, onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";

initializeApp();
const db = getFirestore();

// ============================================================================
// 20장 알림 자동화 + member_uids 동기화
// (기획서에는 없던, Firestore 보안 규칙이 성립하기 위해 필요한 부수 로직 포함)
// ============================================================================

async function createNotification(params: {
  user_id: string;
  notification_type: string;
  reference_type: string;
  reference_id: string;
  title: string;
  content: string;
}) {
  await db.collection("notifications").add({
    ...params,
    is_read: false,
    created_at: Date.now(),
    read_at: null,
  });
}

// ---- meetings/{meetingId}/permissions/{uid} 변경 → meeting.member_uids 동기화 ----
export const syncMeetingMemberUids = onDocumentWritten(
  "meetings/{meetingId}/permissions/{uid}",
  async (event) => {
    const { meetingId, uid } = event.params as { meetingId: string; uid: string };
    const meetingRef = db.collection("meetings").doc(meetingId);
    const afterExists = event.data?.after.exists;

    await meetingRef.update({
      member_uids: afterExists ? FieldValue.arrayUnion(uid) : FieldValue.arrayRemove(uid),
    }).catch((err) => logger.warn(`member_uids sync 실패 (${meetingId})`, err));

    // 공유(share)로 새 권한이 부여된 경우 알림 발송 (본인이 스스로에게 AUTHOR 부여한 경우는 제외)
    if (afterExists) {
      const perm = event.data!.after.data();
      const meetingSnap = await meetingRef.get();
      if (perm && perm.granted_by_user_id !== uid) {
        await createNotification({
          user_id: uid,
          notification_type: "MEETING_SHARED",
          reference_type: "MEETING",
          reference_id: meetingId,
          title: "회의록이 공유되었습니다",
          content: `"${meetingSnap.data()?.meeting_title}" 회의록에 접근 권한이 부여되었습니다.`,
        });
      }
    }
  }
);

// ---- 질의 생성/수정 → 담당자 지정 알림, 답변 완료 알림 ----
export const onQuestionWritten = onDocumentWritten("questions/{questionId}", async (event) => {
  const before = event.data?.before.exists ? event.data.before.data() : null;
  const after = event.data?.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const questionId = event.params.questionId as string;

  if (after.assignee_user_id && after.assignee_user_id !== before?.assignee_user_id) {
    await createNotification({
      user_id: after.assignee_user_id,
      notification_type: "QUESTION_ASSIGNED",
      reference_type: "QUESTION",
      reference_id: questionId,
      title: "새 질의 담당자로 지정되었습니다",
      content: after.question_content,
    });
  }

  if (after.question_status === "ANSWERED" && before?.question_status !== "ANSWERED") {
    await createNotification({
      user_id: after.questioner_user_id,
      notification_type: "QUESTION_ANSWERED",
      reference_type: "QUESTION",
      reference_id: questionId,
      title: "내 질의에 답변이 등록되었습니다",
      content: after.question_content,
    });
  }
});

// ---- 액션 아이템 생성/수정 → 담당자 지정 알림 ----
export const onActionItemWritten = onDocumentWritten("actionItems/{itemId}", async (event) => {
  const before = event.data?.before.exists ? ((event.data.before.data()?.assignee_user_ids as string[]) ?? []) : [];
  const after = event.data?.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const itemId = event.params.itemId as string;

  const newlyAssigned = (after.assignee_user_ids as string[]).filter((uid) => !before.includes(uid));
  for (const uid of newlyAssigned) {
    await createNotification({
      user_id: uid,
      notification_type: "ACTION_ITEM_ASSIGNED",
      reference_type: "ACTION_ITEM",
      reference_id: itemId,
      title: "새 업무 담당자로 지정되었습니다",
      content: after.title,
    });
  }
});

// ---- 후속 회의 연결 생성 → 이전 회의 참석자에게 알림 ----
export const onMeetingRelationCreated = onDocumentCreated("meetingRelations/{relationId}", async (event) => {
  const relation = event.data?.data();
  if (!relation || relation.relation_type !== "FOLLOW_UP") return;

  const parentMeeting = await db.collection("meetings").doc(relation.parent_meeting_id).get();
  const childMeeting = await db.collection("meetings").doc(relation.child_meeting_id).get();
  const memberUids: string[] = parentMeeting.data()?.member_uids || [];

  for (const uid of memberUids) {
    await createNotification({
      user_id: uid,
      notification_type: "FOLLOW_UP_MEETING_CREATED",
      reference_type: "MEETING",
      reference_id: relation.child_meeting_id,
      title: "후속 회의가 생성되었습니다",
      content: `"${parentMeeting.data()?.meeting_title}"의 후속 회의 "${childMeeting.data()?.meeting_title}"가 생성되었습니다.`,
    });
  }
});

// ---- 14장/기한 관리: 매일 자정(KST) 기한 초과·임박 질의/업무 상태 갱신 ----
const OPEN_QUESTION_STATUSES = ["ANSWER_PENDING", "IN_PROGRESS", "NEEDS_CONFIRMATION", "NEXT_MEETING"];
const OPEN_ACTION_STATUSES = ["TODO", "IN_PROGRESS"];

export const dailyDueDateSweep = onSchedule(
  { schedule: "0 15 * * *", timeZone: "Etc/UTC" }, // UTC 15:00 = KST 00:00
  async () => {
    const today = new Date().toISOString().slice(0, 10);

    const overdueQuestions = await db
      .collection("questions")
      .where("question_status", "in", OPEN_QUESTION_STATUSES)
      .where("due_date", "<", today)
      .get();
    for (const doc of overdueQuestions.docs) {
      await doc.ref.update({ question_status: "OVERDUE", updated_at: Date.now() });
      const q = doc.data();
      if (q.assignee_user_id) {
        await createNotification({
          user_id: q.assignee_user_id,
          notification_type: "QUESTION_OVERDUE",
          reference_type: "QUESTION",
          reference_id: doc.id,
          title: "답변 기한이 지난 질의가 있습니다",
          content: q.question_content,
        });
      }
    }

    const overdueActions = await db
      .collection("actionItems")
      .where("status", "in", OPEN_ACTION_STATUSES)
      .where("due_date", "<", today)
      .get();
    for (const doc of overdueActions.docs) {
      await doc.ref.update({ status: "OVERDUE", updated_at: Date.now() });
    }

    logger.info(`기한 초과 처리: 질의 ${overdueQuestions.size}건, 업무 ${overdueActions.size}건`);
  }
);
