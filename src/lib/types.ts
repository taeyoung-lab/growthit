// ============================================================================
// 도메인 타입 정의
// 기획서(AI 회의 연속성·질의·지식관리 시스템 v1.0)의 엔터티를
// Firestore 컬렉션 구조에 맞게 옮긴 타입입니다.
//
// Firestore 매핑 메모:
// - 관계형 문서의 "테이블"은 대부분 최상위 컬렉션으로 옮겼습니다 (조인이 없는 대신
//   자주 같이 쓰는 값은 문서에 함께 저장 - 예: Question에 questioner의 표시이름을 함께 저장).
// - MeetingParticipant / MeetingUserPermission / MeetingShare는 meetings/{id}/... 서브컬렉션으로,
//   Question의 Answer는 questions/{id}/answers 서브컬렉션으로 두었습니다.
// - Decision 변경 이력은 decisions/{id}/history 서브컬렉션에 append합니다 (덮어쓰지 않음).
// ============================================================================

export type ID = string;

// ---- 4. Organization / Department / User -----------------------------------

export interface Organization {
  id: ID;
  organization_name: string;
  organization_code: string;
  organization_status: "ACTIVE" | "INACTIVE";
  created_at: number;
  updated_at: number;
}

export interface Department {
  id: ID;
  organization_id: ID;
  parent_department_id: ID | null;
  department_name: string;
  department_code: string;
  department_status: "ACTIVE" | "INACTIVE";
  created_at: number;
  updated_at: number;
}

export type OrgRole = "ORG_ADMIN" | "MEMBER";

export interface UserProfile {
  id: ID; // Firebase Auth uid와 동일
  organization_id: ID;
  department_id: ID | null;
  user_name: string;
  email: string;
  phone: string | null;
  org_role: OrgRole; // 5장의 "관리자" — 조직 단위 관리 권한. 회의별 권한(AUTHOR/PARTICIPANT/VIEWER)과는 별개.
  user_status: "ACTIVE" | "INACTIVE";
  created_at: number;
  updated_at: number;
}

/** 4.3 화면 표시 원칙: 회사 - 부서 - 이름 */
export function formatUserDisplayName(
  user: Pick<UserProfile, "user_name">,
  org: Pick<Organization, "organization_name"> | null,
  dept: Pick<Department, "department_name"> | null
): string {
  const parts = [org?.organization_name, dept?.department_name, user.user_name].filter(Boolean);
  return parts.join(" - ");
}

// ---- 35. Project -------------------------------------------------------------

export interface Project {
  id: ID;
  organization_id: ID;
  project_name: string;
  project_description: string;
  project_status: "ACTIVE" | "ARCHIVED";
  created_at: number;
  updated_at: number;
}

// ---- 6. Meeting ---------------------------------------------------------------

export type MeetingStatus = "SCHEDULED" | "IN_PROGRESS" | "ANALYZING" | "COMPLETED" | "ARCHIVED";

export interface Meeting {
  id: ID;
  project_id: ID;
  organization_id: ID;
  meeting_title: string;
  meeting_date: string; // YYYY-MM-DD
  meeting_start_time: string | null;
  meeting_end_time: string | null;
  created_by_user_id: ID;
  meeting_status: MeetingStatus;
  // Firestore 조회 최적화를 위한 비정규화 필드: permissions 서브컬렉션에 uid가 추가/제거될 때
  // 함께 갱신합니다. "내가 접근 가능한 회의 목록"을 array-contains로 바로 조회하기 위함입니다.
  member_uids: ID[];
  created_at: number;
  updated_at: number;
}

export type ParticipantType = "HOST" | "ATTENDEE" | "OPTIONAL";
export type AttendanceStatus = "CONFIRMED" | "TENTATIVE" | "DECLINED";

/** meetings/{meetingId}/participants/{userId} */
export interface MeetingParticipant {
  user_id: ID;
  participant_type: ParticipantType;
  attendance_status: AttendanceStatus;
  created_at: number;
}

export type MeetingRole = "AUTHOR" | "PARTICIPANT" | "VIEWER";

/** meetings/{meetingId}/permissions/{userId} */
export interface MeetingUserPermission {
  user_id: ID;
  role: MeetingRole;
  granted_by_user_id: ID;
  granted_at: number;
}

// ---- 8. Transcript (텍스트 입력 기반) ------------------------------------------
// 오디오/STT 대신 사용자가 직접 입력한 텍스트를 세그먼트로 저장합니다.
// "화자 A" 같은 자동 화자분리 대신, 입력 화면에서 각 발언 줄마다 참석자를 지정합니다.

export interface Transcript {
  id: ID; // meeting_id와 1:1이므로 meeting_id를 그대로 사용
  meeting_id: ID;
  input_method: "TEXT_MANUAL" | "TEXT_PASTE"; // 직접 줄 단위 입력 vs 통짜 텍스트 붙여넣기 후 분리
  transcript_status: "DRAFT" | "SUBMITTED" | "ANALYZED";
  raw_text: string; // 붙여넣기 원문 보관 (재분석 대비)
  created_at: number;
  updated_at: number;
}

/** transcripts/{meetingId}/segments/{segmentId} */
export interface TranscriptSegment {
  id: ID;
  meeting_id: ID;
  order: number; // 발화 순서 (텍스트 입력이라 시간 대신 순번 사용)
  speaker_user_id: ID | null; // 참석자 중 지정, 미지정 가능
  speaker_name_raw: string; // 지정 안 했을 때 사용자가 직접 타이핑한 이름
  content: string;
  created_at: number;
}

// ---- 7. MeetingSummary ---------------------------------------------------------

export interface MeetingSummary {
  id: ID; // meeting_id
  meeting_id: ID;
  summary_text: string;
  topics: { title: string; content: string }[];
  generated_by: "CLAUDE_AI";
  model: string;
  created_at: number;
}

// ---- 11 & 14. Question -----------------------------------------------------------

export type QuestionStatus =
  | "ANSWER_PENDING"
  | "IN_PROGRESS"
  | "ANSWERED"
  | "NEEDS_CONFIRMATION"
  | "NEXT_MEETING"
  | "OVERDUE"
  | "CLOSED";

export interface Question {
  id: ID;
  meeting_id: ID;
  project_id: ID;
  organization_id: ID;
  questioner_user_id: ID;
  assignee_user_id: ID | null;
  question_content: string;
  question_status: QuestionStatus;
  due_date: string | null; // YYYY-MM-DD
  source_segment_id: ID | null;
  created_at: number;
  updated_at: number;
}

// ---- 13. Answer (questions/{questionId}/answers/{answerId}) ----------------------

export interface Answer {
  id: ID;
  question_id: ID;
  answerer_user_id: ID;
  answer_content: string;
  source_type: "SAME_MEETING" | "FOLLOW_UP_MEETING" | "MANUAL";
  source_meeting_id: ID;
  source_segment_id: ID | null;
  answered_at: number;
  created_at: number;
  updated_at: number;
}

// ---- 15. ActionItem --------------------------------------------------------------

export type ActionItemStatus = "TODO" | "IN_PROGRESS" | "DONE" | "OVERDUE" | "CANCELLED";

export interface ActionItem {
  id: ID;
  meeting_id: ID;
  project_id: ID;
  organization_id: ID;
  title: string;
  description: string;
  status: ActionItemStatus;
  due_date: string | null;
  created_by_user_id: ID;
  assignee_user_ids: ID[]; // ActionItemAssignee 다대다를 배열로 단순화 (MVP)
  source_segment_id: ID | null;
  created_at: number;
  updated_at: number;
}

// ---- 16. Decision + 변경이력 -------------------------------------------------------

export type DecisionStatus = "ACTIVE" | "SUPERSEDED" | "CANCELLED";

export interface Decision {
  id: ID;
  meeting_id: ID;
  project_id: ID;
  organization_id: ID;
  decision_title: string;
  decision_content: string;
  decision_status: DecisionStatus;
  source_segment_id: ID | null;
  version: number; // 변경될 때마다 +1
  created_at: number;
  updated_at: number;
}

/** decisions/{decisionId}/history/{historyId} — 변경 전 스냅샷을 append (삭제 없음) */
export interface DecisionHistoryEntry {
  id: ID;
  decision_id: ID;
  previous_content: string;
  previous_title: string;
  change_reason: string;
  changed_by_user_id: ID;
  changed_at: number;
  meeting_id: ID; // 어느 회의에서 변경되었는지
}

// ---- 17~19. MeetingRelation --------------------------------------------------------

export type RelationType = "FOLLOW_UP" | "RELATED" | "CONTINUATION";

export interface MeetingRelation {
  id: ID;
  parent_meeting_id: ID;
  child_meeting_id: ID;
  relation_type: RelationType;
  created_by: ID;
  created_at: number;
}

// ---- 21~26. MeetingShare (외부 공유) ------------------------------------------------

export type SharePermission = "VIEWER" | "PARTICIPANT";
export type ShareStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

/** meetings/{meetingId}/shares/{shareId} */
export interface MeetingShare {
  id: ID;
  meeting_id: ID;
  user_id: ID; // 반드시 등록된 시스템 사용자
  share_token: string; // 공유 URL에 들어가는 토큰 (그 자체로는 열람 불가)
  permission: SharePermission;
  share_status: ShareStatus;
  temporary_password_hash: string; // scrypt 해시, 평문 저장 금지
  expires_at: number;
  created_by_user_id: ID;
  created_at: number;
  updated_at: number;
}

export type ShareAccessResult = "SUCCESS" | "FAILURE" | "EXPIRED" | "REVOKED";

/** meetingShareAccessLogs/{logId} */
export interface MeetingShareAccessLog {
  id: ID;
  meeting_id: ID;
  share_id: ID;
  user_id: ID | null;
  email: string;
  access_result: ShareAccessResult;
  accessed_at: number;
  ip_address: string | null;
  user_agent: string | null;
}

// ---- 20. Notification ------------------------------------------------------------

export type NotificationType =
  | "QUESTION_ASSIGNED"
  | "QUESTION_ANSWERED"
  | "QUESTION_DUE_SOON"
  | "QUESTION_OVERDUE"
  | "ACTION_ITEM_ASSIGNED"
  | "FOLLOW_UP_MEETING_CREATED"
  | "MEETING_SHARED";

export interface AppNotification {
  id: ID;
  user_id: ID;
  notification_type: NotificationType;
  reference_type: "QUESTION" | "ACTION_ITEM" | "MEETING" | "DECISION";
  reference_id: ID;
  title: string;
  content: string;
  is_read: boolean;
  created_at: number;
  read_at: number | null;
}

// ---- Claude 분석 결과 스키마 (API 계약) ------------------------------------------------

export interface AiExtractedQuestion {
  content: string;
  questioner_name: string | null;
  assignee_name: string | null;
  due_date: string | null;
  source_segment_order: number | null;
}

export interface AiExtractedDecision {
  title: string;
  content: string;
  source_segment_order: number | null;
}

export interface AiExtractedActionItem {
  title: string;
  description: string;
  assignee_names: string[];
  due_date: string | null;
  source_segment_order: number | null;
}

export interface AiAnalysisResult {
  summary: string;
  topics: { title: string; content: string }[];
  questions: AiExtractedQuestion[];
  decisions: AiExtractedDecision[];
  action_items: AiExtractedActionItem[];
}

export interface AiLinkSuggestion {
  question_id: ID;
  matched_segment_order: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
  suggested_answer_content: string;
}
