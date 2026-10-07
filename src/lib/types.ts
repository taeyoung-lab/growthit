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

// ---- Report Brand (그로스잇 브랜드 정기 성과 리포트 자동화 — Monthly Report 발행 메뉴) --------
// 자동화 대상 브랜드를 설정 문서로 관리합니다.
// 신규 브랜드 추가는 이 문서 1건을 등록하는 것으로 끝나도록 설계해, 코드 수정 없이 브랜드를
// 언제든 추가할 수 있게 합니다(브랜드 관리 화면의 "브랜드 추가" 버튼).
//
// 2026-10-01 결정 변경: CMS 로그인 자격증명(아이디·비밀번호)은 "매번 직접 입력" 대신
// "저장 후 자동 입력/재사용"으로 확정됨(화면 설계 탭 결정 사항 참고). 단, 비밀번호 평문은
// 이 문서(브랜드 전체에서 읽을 수 있는 /brands 컬렉션)에 절대 두지 않고, 클라이언트 Firestore
// 읽기가 전면 차단된 별도 컬렉션 brandCredentials/{brandId}(src/lib/types.ts의 BrandCredentials)에
// 서버(firebase-admin, src/app/api/brands)에서만 암호화해 저장·조회합니다. 이 문서에는 "계정이
// 저장돼 있는지" 여부만 비밀값 없이 보여주는 has_saved_credentials 플래그만 둡니다.

export type ReportBrandStatus = "ACTIVE" | "INACTIVE";

// 2026-10-05: 화면④ "채널 효율 비교"의 수수료 키인값 기본값(설계 문서 결정사항 "수수료 키인값 입력 방식 —
// 브랜드 설정에 기본값 저장, 변경 시에만 수정"). 값은 모두 퍼센트(%) 단위 숫자(예: 1.5 = 1.5%)이며
// 비밀값이 아니라 brands 문서에 그대로 둡니다. null이면 "아직 입력 안 함"입니다.
export interface BrandFeeDefaults {
  delivery_rate: number | null; // 그로스잇 배달 주문 수수료율(%)
  pickup_rate: number | null; // 그로스잇 픽업 주문 수수료율(%)
  // 배달앱 수수료 벤치마크(%) — 업계 평균 10.8%가 기본값이라, 브랜드가 따로 정하지 않으면 null로 두고
  // 화면④가 DEFAULT_BENCHMARK_FEE_RATE를 대신 채웁니다.
  benchmark_rate: number | null;
}

// 설계 문서 화면④: "배달앱 수수료 벤치마크 입력란 — 기본값 10.8%로 미리 채워지고 수정 가능".
export const DEFAULT_BENCHMARK_FEE_RATE = 10.8;
export type BackfillStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

export interface BrandAutoCollect {
  year_month: string; // 대상 연월(YYYY-MM)
  status: "SUCCESS" | "FAILED";
  attempts: number; // 같은 연월에 대한 시도 횟수(성공하면 멈춤, 실패는 최대 3회까지 재시도)
  at: number; // 마지막 시도 시각
  error: string | null; // 실패 원인(짧게 잘라 저장)
}

export interface ReportBrand {
  id: ID;
  organization_id: ID;
  company_name: string; // 회사명
  brand_name: string; // 브랜드명
  cms_url: string; // CMS 사이트 URL — 최초 등록 시 입력
  manager_name: string; // 담당자명 (표시용 — 담당자들의 이름을 ", "로 이은 값, 서버가 manager_uids로부터 만듦)
  created_by: ID; // 등록한 사용자 uid — 항상 담당자에 포함(해제 불가)
  // 2026-10-06: 복수 담당자. 이 브랜드의 조회·수집·리포트 발행·수정 권한을 갖는 사용자 uid 목록
  // (슈퍼 관리자는 목록과 무관하게 항상 접근 가능). 이 필드가 없는 기존 브랜드는 [created_by]로 간주합니다
  // — src/lib/brandAccess.ts의 brandManagerUids 참고. 생성자는 서버가 항상 포함시킵니다.
  manager_uids?: ID[];
  // 브랜드별 로그인 방식을 코드 분기 대신 설정값(옵션)으로 일반화한 필드 — 브레댄코처럼
  // ID/PW 로그인 후 전화번호 인증(고정값) 단계가 추가로 있는 브랜드는 true로 등록합니다.
  // 자동화 스크립트는 이 값을 읽어 헤드리스 브라우저에서 해당 단계를 추가로 처리할지 결정합니다.
  phone_verification_required: boolean;
  // CMS 계정이 brandCredentials에 저장돼 있는지 여부(비밀값은 아님, UI 표시·분기용) —
  // true면 Monthly Report 발행 화면②에서 계정 입력란이 자동으로 채워진 상태로 표시됩니다.
  has_saved_credentials: boolean;
  // 서비스 오픈일(YYYY-MM-DD) — 브랜드 생성 시 입력. 설정돼 있으면 등록 직후 이 날짜부터
  // 현재월의 전월까지 과거 데이터를 CMS에서 한 번에 가져와 DB(brandMonthlyData)에 반영하는
  // 백필(backfill)이 자동 실행됩니다(월별 리뷰 없이 일괄 반영, PPT는 생성하지 않음 — 2026-10-01 결정).
  service_open_date: string | null;
  backfill_status: BackfillStatus | null; // 백필 미대상(서비스 오픈일 미입력)이면 null
  // 백필이 "지나간" 가장 최근 연월(YYYY-MM), 진행률 표시용 — 실제로 데이터가 반영된 달뿐 아니라
  // 아래 backfill_skipped_months에 기록된, CMS 자체 문제로 건너뛴 달도 포함해 전진합니다(한 달이
  // 계속 실패한다고 그 뒤 달들까지 영원히 막히지 않도록 — 2026-10-02 결정, backfill.ts 참고).
  backfill_completed_through: string | null;
  // 2026-10-02: 재시도로도 해결되지 않는 CMS 서버 자체의 문제(예: 브래덴코 2026-06 정산 조회가
  // 저희 타임아웃 설정과 무관하게 매번 정확히 60초에 504로 끊기는 것을 직접 재현까지 포함해
  // 3회 연속 확인 — 담당자 확인 후 해당 달은 건너뛰고 다음 달부터 진행하기로 결정)로 인해
  // 실제 데이터 없이 건너뛴 연월(YYYY-MM) 목록 — 브랜드 관리 화면에 표시해 담당자가 나중에
  // CMS 쪽과 별도로 확인/재수집할 수 있게 합니다. 백필 미대상 브랜드이거나 아직 건너뛴 달이
  // 없으면 빈 배열.
  backfill_skipped_months: string[];
  // 그로스잇 수수료 기본값(%). 2026-10-05 이전에 만든 브랜드는 필드 자체가 없을 수 있어 optional입니다.
  fee_defaults?: BrandFeeDefaults;
  // 가장 최근으로 "발행"(PPT 생성)까지 완료된 연월(YYYY-MM) — 화면④의 전월대비(MoM) 자동 조회,
  // 화면①의 "기존 발행 이력 유무" 표시에 사용. 백필로만 채워진 월은 포함하지 않습니다.
  last_published_month: string | null;
  // 2026-10-07: 자동 월간 수집(/api/cron/collect-monthly)의 가장 최근 시도 결과 — 브랜드 관리 화면 표시와
  // 실패 재시도 횟수 관리용. 한 번도 자동 수집된 적이 없으면 없음.
  auto_collect?: BrandAutoCollect;
  brand_status: ReportBrandStatus; // INACTIVE = 목록에서 비활성화(soft-delete), 기존 데이터는 보존
  created_at: number;
  updated_at: number;
}

// brandCredentials/{brandId} — CMS 로그인 자격증명 전용 컬렉션. firestore.rules에서 클라이언트의
// read/write를 전면 차단하고(allow read, write: if false), src/app/api/brands의 서버 코드(firebase-admin)
// 에서만 접근합니다. cms_password는 평문이 아니라 src/lib/cmsCredentials.ts로 암호화한 값입니다.
export interface BrandCredentials {
  brand_id: ID;
  cms_username: string;
  cms_password_encrypted: string;
  // 브레댄코처럼 phone_verification_required=true인 브랜드만 사용. 실제 SMS가 오는 게 아니라
  // 항상 동일한 고정 인증번호를 쓰는 구조라, cms_password와 동일한 방식(AES-256-GCM)으로
  // 암호화해 저장합니다. phone_verification_required=false인 브랜드는 null.
  fixed_verification_code_encrypted: string | null;
  // 2026-10-02: 백필이 "백필 이어하기" 클릭마다 매번 새 서버 실행(invocation)으로 로그인을 처음부터
  // 다시 하다 보니(헤드리스 브라우저 로그인 3~6초) 60초 서버리스 시간 제한 안에서 느린 CMS 호출에
  // 쓸 수 있는 여유가 너무 빠듯해지는 문제가 있었습니다(2026-03 백필 조사 참고). 로그인으로 얻은
  // 세션 쿠키를 여기 암호화해 저장해두고, 일정 시간(backfill.ts의 SESSION_CACHE_TTL_MS) 안이면
  // 다음 실행에서 로그인을 건너뛰고 바로 재사용합니다 — cms_password_encrypted와 동일한 방식
  // (AES-256-GCM)으로 암호화하고, 저장 위치도 이미 클라이언트 접근이 전면 차단된 이 컬렉션을
  // 그대로 씁니다. 캐시된 세션이 없거나 만료됐으면 null.
  cms_session_cookie_encrypted: string | null;
  cms_session_cached_at: number | null;
  updated_by: ID;
  updated_at: number;
}

// brandMonthlyData/{brandId}_{yyyyMM} — 브랜드×연월 단위로 CMS에서 수집한 raw 집계 데이터 1건.
// 월간 발행 플로우(화면③→④)와 백필 둘 다 이 컬렉션에 씁니다. 8개 섹션 원본값은 data에 그대로 두고,
// 사용자가 화면④에서 직접 고친 값(수수료 키인값 등)은 overrides에 별도로 보관해 원본과 구분합니다.
export type BrandMonthlyDataSource = "MANUAL" | "BACKFILL" | "AUTO"; // AUTO = 매월 자동 수집(Vercel Cron)

export interface BrandMonthlyData {
  id: ID; // `${brand_id}_${year_month}`
  organization_id: ID;
  brand_id: ID;
  year_month: string; // YYYY-MM
  source: BrandMonthlyDataSource; // 월간 발행 플로우에서 수집했는지, 백필로 수집했는지
  data: Record<string, unknown>; // CMS에서 수집한 8개 섹션 원본 집계값
  overrides: Record<string, unknown>; // 화면④에서 담당자가 직접 수정한 값(수수료 키인값 등)
  published: boolean; // PPT까지 생성해 발행 완료했는지 — 백필 전용 월은 false로 남음
  collected_at: number;
  collected_by: ID | null; // 백필처럼 서버가 자동 실행한 경우 null
  updated_at: number;
}

// reportPublishHistory/{id} — 화면⑤ "발행 이력". PPT 생성까지 완료된 건만 남습니다.
export interface ReportPublishHistory {
  id: ID;
  organization_id: ID;
  brand_id: ID;
  year_month: string; // YYYY-MM — 당월·과거월 재발행 모두 가능(화면① 참고)
  // PPT는 저장소에 올리지 않고 발행 시점에 바로 내려받는 방식(2026-10-01 "다운로드만 제공" 결정)이라 null입니다.
  ppt_storage_path: string | null;
  file_name?: string;
  published_by: ID;
  published_at: number;
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
  // 생성 시점 회의의 member_uids 스냅샷 (LIST 쿼리 보안 규칙 제약 우회용 — Meeting.member_uids 주석 참고)
  member_uids: ID[];
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
  // 생성 시점 회의의 member_uids 스냅샷 (LIST 쿼리 보안 규칙 제약 우회용 — Meeting.member_uids 주석 참고)
  member_uids: ID[];
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
  // 생성 시점 회의의 member_uids 스냅샷 (LIST 쿼리 보안 규칙 제약 우회용 — Meeting.member_uids 주석 참고)
  member_uids: ID[];
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
  // 생성 시점 child 회의의 member_uids 스냅샷 (LIST 쿼리 보안 규칙 제약 우회용 — Meeting.member_uids 주석 참고)
  member_uids: ID[];
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
