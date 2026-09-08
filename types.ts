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
//
// 2026-09-08 개편 (Phase 10):
// - AI 자동분석 기능 완전 제거 (Claude 연동 관련 타입 삭제)
// - 계정 권한(org_role)을 SUPER_ADMIN / ADMIN / USER 3단계로 재정의
//   · SUPER_ADMIN: 모든 기능 + 관리 기능 + 전체 컨텐츠
//   · ADMIN: 전체 컨텐츠 열람만 (관리 기능 없음)
//   · USER: 회의록 단위로 편집자(AUTHOR)/참여자(PARTICIPANT) 권한을 부여받음
//   "열람자"는 별도 계정 권한이 아니라 기존 MeetingShare(회의별 외부 공유) 기능 그대로 사용
// - 회의록을 텍스트 채록+AI추출이 아닌 구조화된 수기 입력으로 변경 (장소/참석자 구조 추가)
// - 알림은 개별 저장 없이 접속 시 "지난 방문 이후 업데이트"를 계산해서 보여주는 방식으로 축소
//   (UserProfile.last_dashboard_visit_at 기준으로 클라이언트에서 계산 — AppNotification 컬렉션 제거)
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

/**
 * 계정 권한 3단계 (2026-09-08 재정의):
 * - SUPER_ADMIN: 모든 기능과 관리 기능(인원관리 등)에 접근 + 전체 컨텐츠 열람
 * - ADMIN: 관리 기능은 없지만 전체 컨텐츠 열람 가능
 * - USER: 일반 사용자 — 회의록 단위 편집자(AUTHOR)/참여자(PARTICIPANT) 권한으로 접근
 * 회의별 "열람자"는 이 org_role과 무관하게 기존 MeetingShare(공유 링크) 기능으로 처리합니다.
 */
export type OrgRole = "SUPER_ADMIN" | "ADMIN" | "USER";

export interface UserProfile {
  id: ID; // Firebase Auth uid와 동일
  organization_id: ID;
  department_id: ID | null;
  user_name: string;
  email: string;
  phone: string | null;
  org_role: OrgRole;
  user_status: "ACTIVE" | "INACTIVE"; // INACTIVE = 관리자가 삭제(soft-delete) 처리한 계정, 기존 데이터는 보존
  must_change_password: boolean; // true면 로그인 직후 비밀번호 변경 화면으로 강제 이동
  last_dashboard_visit_at: number | null; // 알림 축소 기능: 마지막 대시보드 접속 시각
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

export type MeetingStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "ARCHIVED";

/** 참석자 1인 (이름 + 직책) */
export interface AttendeePerson {
  name: string;
  title: string;
}

/** 참석자 구성: 고객사 쪽과 와일리 쪽을 분리해서 관리 */
export interface MeetingAttendees {
  client_company_name: string;
  client_attendees: AttendeePerson[];
  wylie_attendees: AttendeePerson[];
}

export interface Meeting {
  id: ID;
  project_id: ID;
  organization_id: ID;
  meeting_title: string; // 회의 목적/제목
  meeting_date: string; // YYYY-MM-DD (캘린더로 입력)
  meeting_start_time: string | null;
  meeting_end_time: string | null;
  location: string; // 장소 (키인)
  attendees: MeetingAttendees;
  created_by_user_id: ID;
  meeting_status: MeetingStatus;
  // Firestore 조회 최적화를 위한 비정규화 필드: permissions 서브컬렉션에 uid가 추가/제거될 때
  // 함께 갱신합니다 ("내가 접근 가능한 회의 목록"을 array-contains로 바로 조회하기 위함).
  // 주의: Cloud Functions를 쓰지 않으므로, permissions 서브컬렉션에 쓰기를 하는 모든 서버 코드는
  // 반드시 src/lib/firebase/meetingAccess.ts의 헬퍼로 이 필드를 함께 갱신해야 합니다.
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

/** meetings/{meetingId}/permissions/{userId} — 회의록 단위 권한: 편집자(AUTHOR)/참여자(PARTICIPANT) */
export interface MeetingUserPermission {
  user_id: ID;
  role: MeetingRole;
  granted_by_user_id: ID;
  granted_at: number;
}

// ---- 7. MeetingSummary (구조화된 수기 입력) --------------------------------------
// AI 자동추출 대신, 회의 작성 화면에서 직접 입력합니다.
// topics = "논의내용" 섹션 (제목+내용, "+" 버튼으로 무한 생성)

export interface MeetingSummary {
  id: ID; // meeting_id
  meeting_id: ID;
  summary_text: string; // 회의 요약
  topics: { title: string; content: string }[]; // 논의내용
  created_at: number;
  updated_at: number;
}

// ---- 11 & 14. Question -----------------------------------------------------------
// 회의 작성 폼과는 별개로, 회의 상세(조회) 화면의 "문답(Q&A)" 스레드에서 직접 작성합니다.

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
  created_at: number;
  updated_at: number;
}

// ---- 13. Answer (questions/{questionId}/answers/{answerId}) ----------------------

export interface Answer {
  id: ID;
  question_id: ID;
  answerer_user_id: ID;
  answer_content: string;
  source_meeting_id: ID;
  answered_at: number;
  created_at: number;
  updated_at: number;
}

// ---- 15. ActionItem (= 향후추진과제) ------------------------------------------------
// 회의 작성 화면의 "향후추진과제" 테이블(담당주체/주요추진과제/추진일정/비고)에 대응합니다.
// 상태는 회의 상세 화면에서 직접 관리합니다 (별도 cross-meeting 관리 화면 없음).
// 메인 대시보드의 "담당자별" 섹션은 assignee_user_ids 기준으로 이 컬렉션을 모아 보여줍니다.

export type ActionItemStatus = "TODO" | "IN_PROGRESS" | "DONE" | "OVERDUE" | "CANCELLED";

export interface ActionItem {
  id: ID;
  meeting_id: ID;
  project_id: ID;
  organization_id: ID;
  title: string; // 주요 추진과제
  description: string; // 비고
  status: ActionItemStatus;
  due_date: string | null; // 추진일정
  created_by_user_id: ID;
  assignee_user_ids: ID[]; // 담당주체 (다대다를 배열로 단순화 - MVP)
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

// ---- 21~26. MeetingShare (외부 공유 = "열람자") ------------------------------------
// 열람자는 별도 계정 권한이 아니라, 이 기능으로 특정 회의 1건에 한해 공유됩니다.
// 공유받은 사람은 그 회의의 관리 기능을 제외한 전체 내용(개요/요약/논의내용/향후추진과제/Q&A)을 볼 수 있습니다.

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
