// 그로스잇 브랜드 CMS 자동 로그인·데이터 수집 — 공통 타입.
// 2026-10-01: 청자다방 테스트계정으로 실제 CMS를 직접 열람해 로그인 폼·JSON API 구조를 확인하고
// 작성했습니다(src/lib/cmsAutomation/login.ts, collect.ts 상단 주석 참고). 다른 7개 브랜드는 같은
// 코드베이스 기반 멀티테넌트 CMS로 추정되지만, 실제 연동 전 브랜드별로 한 번씩 구조 확인이 필요합니다.

export interface CmsLoginConfig {
  cmsUrl: string; // 예: https://cheongjadb-cms.growthit.co.kr/
  username: string;
  password: string;
  // 브레댄코처럼 ID/PW 로그인 후 전화번호 인증(고정 인증번호) 단계가 추가로 있는 브랜드에만 설정.
  phoneVerificationRequired: boolean;
  fixedVerificationCode: string | null;
}

/** 로그인 성공 후 이후 API 호출에 그대로 실어 보낼 쿠키 문자열(`a=1; b=2` 형식). */
export interface CmsSession {
  cookieHeader: string;
}

export interface CmsCollectionResult {
  yearMonth: string; // YYYY-MM
  dashboard: unknown; // GET /api/dashboard (월조회) 원본 응답 — 매출·주문수·회원수 등
  settlementsSales: unknown; // GET /api/settlements/sales (월조회) 원본 응답 — 수수료 실측값
  targetGroupStats: unknown; // GET /api/stats/targetGroup 원본 응답 — 회원 세그먼트
  // 2026-10-02 테스트_브래덴코 네트워크 탭에서 직접 확인(표준형 기준만 검증 — 처갓집/샐러리아는
  // 미검증). 위 3개와 달리 조회 실패 시에도 전체 수집이 실패하지 않도록 null을 허용합니다
  // (collect.ts의 Promise.allSettled 처리 참고) — 아직 해당 브랜드 CMS에 이 엔드포인트가
  // 존재하는지 확인되지 않았으므로, 실패해도 기존 3개 데이터는 정상적으로 저장되게 하기 위함.
  storeManage: unknown | null; // GET /api/storeManage 원본 응답 — 매장 목록(상태·스탬프·배달/픽업 등)
  memberStats: unknown | null; // GET /api/stats/member 원본 응답 — 월말 기준 성별×연령대 회원 등급 분포
  collectedAt: number;
}

export class CmsAutomationError extends Error {
  // "SESSION_EXPIRED": 2026-10-02 로그인 세션 재사용 도입 — 캐시해둔 쿠키로 호출했는데 CMS가
  // 401/403을 돌려줬을 때만 씁니다(collect.ts의 getJson 참고). backfill.ts가 이 경우를 일반
  // COLLECT 실패와 구분해, 브랜드를 FAILED로 표시하는 대신 캐시된 세션만 비우고 다음 실행에서
  // 재로그인하도록 처리합니다.
  //
  // "GATEWAY_TIMEOUT": 2026-10-02 (같은 날 추가) — CMS가 504를 돌려줬을 때만 씁니다. 이건 저희 쪽
  // CMS_FETCH_TIMEOUT_MS(요청측 타임아웃)와는 무관하게 CMS 서버/인프라 자체가 요청을 포기한
  // 경우라(브래덴코 2026-06 정산 조회가 저희 타임아웃을 110초로 올린 뒤에도 매번 정확히 60초에
  // 504로 끊기는 것을 직접 재현까지 포함해 3회 연속 확인 — 담당자 확인 완료), 저희 쪽 타임아웃을
  // 아무리 올려도 해결되지 않습니다. backfill.ts가 이 경우를 일반 COLLECT 실패와 구분해, 그 달을
  // backfill_skipped_months에 기록하고 건너뛴 뒤 다음 달부터 계속 진행하도록 처리합니다(한 달이
  // CMS 쪽 문제로 막히면 그 뒤 달들까지 전부 멈춰버리는 것을 막기 위함).
  step: "LOGIN" | "PHONE_VERIFICATION" | "COLLECT" | "SESSION_EXPIRED" | "GATEWAY_TIMEOUT";
  constructor(
    message: string,
    step: "LOGIN" | "PHONE_VERIFICATION" | "COLLECT" | "SESSION_EXPIRED" | "GATEWAY_TIMEOUT"
  ) {
    super(message);
    this.step = step;
  }
}

