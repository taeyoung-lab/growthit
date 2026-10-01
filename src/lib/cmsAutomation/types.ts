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
  collectedAt: number;
}

export class CmsAutomationError extends Error {
  step: "LOGIN" | "PHONE_VERIFICATION" | "COLLECT";
  constructor(message: string, step: "LOGIN" | "PHONE_VERIFICATION" | "COLLECT") {
    super(message);
    this.step = step;
  }
}

