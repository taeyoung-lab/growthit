import type { CmsCollectionResult, CmsSession } from "./types";

// 로그인 이후 데이터 수집 — 화면을 다시 띄우지 않고, 로그인으로 얻은 쿠키를 그대로 실어 CMS가
// 내부적으로 쓰는 JSON API를 직접 호출합니다(login.ts 상단 주석 참고 — 2026-10-01 청자다방
// 테스트계정으로 Chrome 네트워크 탭에서 직접 확인한 엔드포인트입니다).
//
// 확인된 엔드포인트 3개(표준형 기준):
// - GET /api/dashboard        — 월조회(searchTp=month) 시 매출·주문수·전체/신규 회원수·매장별 매출 등
// - GET /api/settlements/sales — 수수료 실측값(PG수수료·서비스이용수수료·예상정산금)
// - GET /api/stats/targetGroup — 화면상 "최근 N일" 형태의 일별 로우 목록(월 집계 모드 없음)이라,
//   끝 날짜(endDt)를 해당 월 말일로 주고 그 달에 해당하는 로우만 추려 쓰는 방식으로 호출합니다.
//   (타겟그룹 엔드포인트는 2026-10-02 8개 브랜드 전수 검증 결과 변형 없이 전부 동일했습니다.)
//
// 2026-10-02: "8개 브랜드가 동일 코드베이스 기반"이라는 처음 추정은 틀렸습니다. 실제로 전수 라이브
// 네트워크 검증(처갓집 브라우저 로그인 직접 관찰 + 나머지 7개 브랜드 Chrome 네트워크 탭 전수 확인)
// 결과, 최소 3가지 CMS API 변형이 존재함을 확인했습니다:
//   - "표준형"(8개 중 6개: 포트캔커피·영커피·에그드랍·우지커피·테스트_브래덴코·test) — 아래
//     getDashboard/getSettlements의 "standard" 분기와 완전히 일치.
//   - "분리형 대시보드"(처갓집양념치킨, dashboard="granular") — /api/dashboard 자체가 없고
//     /api/dashboard/summary 등 세분화된 엔드포인트(sales-chart·heatmap·age-gender 등 총 11개)로
//     쪼개져 있음. 그중 요약 통계에 해당하는 /api/dashboard/summary만 우선 연동했습니다 — 나머지는
//     존재만 확인했을 뿐 응답 내용은 검증 전이라, 화면④(리포트 편집 화면) 설계 시점에 실제로
//     필요한 값을 다시 확인한 뒤 추가하는 게 안전합니다.
//   - "기간형 정산"(샐러리아, settlement="dateRange") — 대시보드·타겟그룹은 표준형과 동일하지만,
//     정산(/api/settlements/sales)만 searchTp/searchDt가 아니라 searchStartDt~searchEndDt(날짜
//     범위)를 씀. 이게 바로 기존에 보고됐던 500 에러의 원인이었습니다. (처갓집은 정산에서 또 다른
//     날짜범위 방식인 dateType=SETTLE&fromDt~toDt를 씀 — settlement="settleRange" — 샐러리아와도
//     다릅니다.)
//
// 신규 브랜드를 등록했는데 "지금 수집(테스트)"가 404/500으로 실패하거나, 성공은 하는데 매출·주문수가
// 전부 0으로만 나와 의심스러우면 — 겉보기엔 정상 200 응답이지만 실제로는 틀린 엔드포인트를 때린 것일
// 수 있습니다(처갓집에서 실제로 있었던 사례: 틀린 엔드포인트를 때렸는데도 200 + 전부 0으로 응답해
// 한참 원인 파악이 늦어졌습니다). 자동으로 변형을 판별하지는 않기로 했습니다(2026-10-02 결정 — 리포트
// 수치 정확성이 더 중요하다고 판단해, 자동 감지보다 CMS를 라이브로 직접 열어 실제 네트워크 요청을
// 확인한 뒤 CMS_API_VARIANTS에 새 항목을 추가하는 방식을 선택). 신규 브랜드 오류 발생 시에도 이
// 과정을 다시 거쳐 예외를 추가해주세요.

type DashboardVariant = "standard" | "granular";
type SettlementVariant = "standard" | "dateRange" | "settleRange";

interface CmsApiVariant {
  dashboard: DashboardVariant;
  settlement: SettlementVariant;
}

const DEFAULT_VARIANT: CmsApiVariant = { dashboard: "standard", settlement: "standard" };

// cmsUrl의 호스트명을 키로 사용합니다(브랜드명이 바뀌어도 CMS URL 호스트는 잘 안 바뀌는 편이라
// 더 안정적입니다). 신규 브랜드는 기본적으로 DEFAULT_VARIANT(표준형)로 시도되며, 여기 없는
// 브랜드가 404/500 또는 의심스러운 0값으로 실패하면 라이브 검증 후 이 목록에 항목을 추가하세요.
const CMS_API_VARIANTS: Record<string, CmsApiVariant> = {
  "cheogajip-cms.growthit.co.kr": { dashboard: "granular", settlement: "settleRange" },
  "salaria-cms.woori-it.co.kr": { dashboard: "standard", settlement: "dateRange" },
};

function getApiVariant(cmsUrl: string): CmsApiVariant {
  try {
    const host = new URL(cmsUrl).hostname;
    return CMS_API_VARIANTS[host] ?? DEFAULT_VARIANT;
  } catch {
    return DEFAULT_VARIANT;
  }
}

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

function firstDayOfMonth(yearMonth: string): string {
  return `${yearMonth}-01`;
}

// 2026-10-02: 테스트_브래덴코 백필 중 Vercel 함수가 60초 하드 타임아웃으로 강제 종료되는 사고가
// 발생. 원인 확인 결과 이 브랜드의 CMS 응답이 유독 느려서(영커피 월평균 1.36초 vs 브래덴코 월평균
// 10초+) backfill.ts의 TIME_BUDGET_MS(45초) 체크는 "달 시작 전"에만 보기 때문에, 느린 호출 하나가
// 진행 중인 동안은 멈출 방법이 없어 그대로 Vercel 하드 리밋에 끌려가 강제 종료됨 — backfill_status가
// IN_PROGRESS에 멈춘 채로 남는 등 불완전한 상태가 됨. 요청 1건마다 타임아웃을 걸어, 느린 CMS라도
// "그 달만" 실패 처리되고 backfill.ts의 기존 catch 블록이 정상적으로 FAILED + 부분 진행상황 저장을
// 하도록 만듦(= Vercel에 강제로 죽는 것보다 훨씬 안전한 실패 모드로 전환).
//
// 15초로 처음 배포했다가 브래덴코 2025-08 정산 조회가 매번 타임아웃되는 것을 확인 — 버그가 아니라
// 브래덴코 CMS 자체가 느린 게 맞는지 직접 라이브로 검증함(브래덴코 CMS에 로그인해 매출 정산 화면을
// 월조회·2025-08로 직접 조회 — 42개 매장·996건 주문 집계라 5초 시점엔 아직 이전 응답이었고 15초
// 시점엔 이미 새 결과가 떠 있었음, 즉 실제 CMS 응답 자체가 10~15초대). 42개 매장(영커피 등은 매장
// 1곳)이라 집계량이 커서 생기는 정상적인 지연이므로, 쿼리를 바꾸는 대신 타임아웃을 30초로 올림.
//
// backfill.ts가 이 값을 가져다 "다음 달을 시작해도 안전한지" 판단하는 데 쓰므로(60초 하드 리밋
// 안에서 역산), export합니다 — 둘이 따로 노는 상수로 각자 관리되다 보니 이번에 30초로 올렸을 때
// backfill.ts의 TIME_BUDGET_MS(45초, 고정값)는 안 고쳐서 또 504가 났습니다(로그인+2개월 완료 후
// 3번째 달 시작 시점이 45초 budget 안이라 진행했는데, 그 달이 타임아웃 꽉 채우면서 60초 하드
// 리밋을 넘겨버림). 같은 실수가 반복되지 않도록 이 상수 하나로 양쪽이 맞물리게 함(동적 예산 계산,
// 2026-10-02 backfill.ts 수정 참고).
//
// 2026-10-02 (동적 예산 계산 배포 후): 브래덴코 2025-11 정산 조회가 30초를 세 번 연속 초과 —
// 우려했던 "원래 느린 CMS를 또 가린 건 아닌지"를 직접 fetch로 재현해 확인함(백엔드와 완전히 동일한
// URL·파라미터로 브라우저에서 직접 요청 — 31.3초 소요, 거의 정확히 일치). 2025-08(996건)보다 2025-11
// 주문량(1,555건)이 더 많아서 생기는 정상적인 지연으로 판단, 30→45초로 추가 상향. backfill.ts의
// 중단 로직이 이 값에서 자동으로 역산되므로(HARD_LIMIT_MS - SAFETY_MARGIN_MS 기준) 이 상수만
// 바꾸면 되고 TIME_BUDGET_MS류 상수를 따로 손볼 필요가 없음 — 바로 그 재발 방지가 지난 수정의 목적.
export const CMS_FETCH_TIMEOUT_MS = 45_000;

async function getJson(cmsUrl: string, path: string, cookieHeader: string): Promise<unknown> {
  const url = new URL(path, cmsUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CMS_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Cookie: cookieHeader, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`CMS API 응답 지연(${CMS_FETCH_TIMEOUT_MS / 1000}초 초과) — ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`CMS API 호출 실패 (${res.status}) — ${url}`);
  }
  return res.json();
}

async function getDashboard(
  variant: DashboardVariant,
  cmsUrl: string,
  cookieHeader: string,
  yearMonth: string,
  endDt: string
): Promise<unknown> {
  if (variant === "granular") {
    // 처갓집형 — /api/dashboard가 없고 요약 통계는 /api/dashboard/summary로 분리돼 있습니다.
    // 2026-10-02 라이브 재검증: 표준형과 달리 searchTp=month일 때 searchDt는 전체 날짜
    // (YYYY-MM-DD)가 아니라 연-월(YYYY-MM)만 받습니다 — 전체 날짜를 넘기면 서버가 이를
    // 엉뚱한 단일 일자로 해석해 주문수가 음수로 나오는 등 월 집계가 깨지는 것을 확인했습니다
    // (처갓집 CMS를 직접 열어 월조회 전환 시 실제 네트워크 요청을 캡처해 확인).
    const query = `searchTp=month&isStoreAdmin=false&storeNm=&storeId=0&searchDt=${yearMonth}`;
    return getJson(cmsUrl, `/api/dashboard/summary?${query}`, cookieHeader);
  }
  const query =
    `page=1&perPage=5&searchTp=month&isStoreAdmin=false&storeNm=&storeId=0&searchDt=${endDt}` +
    `&regionSalesTp=total&storeSalesTp=total&bestTp=cnt`;
  return getJson(cmsUrl, `/api/dashboard?${query}`, cookieHeader);
}

async function getSettlements(
  variant: SettlementVariant,
  cmsUrl: string,
  cookieHeader: string,
  startDt: string,
  endDt: string
): Promise<unknown> {
  if (variant === "dateRange") {
    // 샐러리아형 — searchTp 자체가 없고 searchStartDt~searchEndDt로 범위를 직접 지정합니다.
    // 2026-10-02 실제 월간 수집(2026-09)으로 재검증 완료 — 대시보드와 정산 금액·주문건수가
    // 정확히 일치함을 확인했습니다(매출 10,337,800원·826건 동일).
    const query = `page=1&perPage=500&storeNm=&storeId=&orderGb=&searchOrderGb=&searchStartDt=${startDt}&searchEndDt=${endDt}`;
    return getJson(cmsUrl, `/api/settlements/sales?${query}`, cookieHeader);
  }
  if (variant === "settleRange") {
    // 처갓집형 — dateType=SETTLE + fromDt~toDt(월초~월말). 2026-10-02 라이브 재검증(처갓집
    // CMS 매출 정산 화면에서 "이전달" 이동 후 검색) 결과 이 쿼리 형태가 실제 화면 요청과
    // 정확히 일치함을 확인했습니다. (9월 정산액이 0으로 나오는 건 쿼리 문제가 아니라 — 같은
    // 화면에서도 0으로 뜸 — 이 브랜드가 아직 정산 발생 전/테스트 데이터 상태이기 때문입니다.)
    const query = `page=1&perPage=500&storeNm=&storeId=&dateType=SETTLE&fromDt=${startDt}&toDt=${endDt}`;
    return getJson(cmsUrl, `/api/settlements/sales?${query}`, cookieHeader);
  }
  const query = `page=1&perPage=500&searchTp=month&storeNm=&storeId=&orderGb=&searchOrderGb=&searchDt=${endDt}`;
  return getJson(cmsUrl, `/api/settlements/sales?${query}`, cookieHeader);
}

export async function collectMonthlyData(
  cmsUrl: string,
  session: CmsSession,
  yearMonth: string
): Promise<CmsCollectionResult> {
  const endDt = lastDayOfMonth(yearMonth);
  const startDt = firstDayOfMonth(yearMonth);
  const { cookieHeader } = session;
  const variant = getApiVariant(cmsUrl);

  const targetGroupQuery = `page=1&perPage=31&endDt=${endDt}`;

  const [dashboard, settlementsSales, targetGroupStats] = await Promise.all([
    getDashboard(variant.dashboard, cmsUrl, cookieHeader, yearMonth, endDt),
    getSettlements(variant.settlement, cmsUrl, cookieHeader, startDt, endDt),
    getJson(cmsUrl, `/api/stats/targetGroup?${targetGroupQuery}`, cookieHeader),
  ]);

  return { yearMonth, dashboard, settlementsSales, targetGroupStats, collectedAt: Date.now() };
}
