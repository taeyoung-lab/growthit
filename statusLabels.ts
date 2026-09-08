import type { QuestionStatus, ActionItemStatus, MeetingStatus } from "@/lib/types";

export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  ANSWER_PENDING: "답변 대기",
  IN_PROGRESS: "확인 중",
  ANSWERED: "답변 완료",
  NEEDS_CONFIRMATION: "추가 확인 필요",
  NEXT_MEETING: "다음 회의 논의",
  OVERDUE: "기한 초과",
  CLOSED: "종료",
};

export const QUESTION_STATUS_BADGE: Record<QuestionStatus, string> = {
  ANSWER_PENDING: "badge-pending",
  IN_PROGRESS: "badge-progress",
  ANSWERED: "badge-answered",
  NEEDS_CONFIRMATION: "badge-pending",
  NEXT_MEETING: "badge-progress",
  OVERDUE: "badge-overdue",
  CLOSED: "badge-closed",
};

export const ACTION_ITEM_STATUS_LABEL: Record<ActionItemStatus, string> = {
  TODO: "예정",
  IN_PROGRESS: "진행 중",
  DONE: "완료",
  OVERDUE: "기한 초과",
  CANCELLED: "취소",
};

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  SCHEDULED: "예정",
  IN_PROGRESS: "진행 중",
  COMPLETED: "완료",
  ARCHIVED: "보관",
};

/** 14장 미답변 질의 우선순위: 기한초과 > 오늘마감 > 임박 > 오래된 순 > 일반 */
export function questionPriorityScore(status: QuestionStatus, dueDate: string | null): number {
  if (status === "OVERDUE") return 0;
  if (!dueDate) return 4;
  const days = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  if (days <= 0) return 0;
  if (days === 1) return 1;
  if (days <= 3) return 2;
  return 3;
}
