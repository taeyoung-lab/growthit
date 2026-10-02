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

async function getJson(cmsUrl: string, path: string, cookieHeader: string): Promise<unknown> {
  const url = new URL(path, cmsUrl).toString();
  const res = await fetch(url, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`CMS API 호출 실패 (${res.status}) — ${url}`);
  }
  return res.json();
}

async function getDashboard(
  variant: DashboardVariant,
  cmsUrl: string,
  cookieHeader: string,
  endDt: string
): Promise<unknown> {
  if (variant === "granular") {
    // 처갓집형 — /api/dashboard가 없고 요약 통계는 /api/dashboard/summary로 분리돼 있습니다.
    // 쿼리 파라미터는 표준형 대시보드 호출과 동일한 패턴(searchTp=month&searchDt=월말일)을
    // 썼습니다 — 실제 월간 집계로 동작하는지는 이번 변경 적용 후 첫 "지금 수집(테스트)" 실행
    // 결과로 확인이 필요합니다(라이브 관찰 시엔 UI 기본값인 "오늘 하루"만 확인했습니다).
    const query = `searchTp=month&isStoreAdmin=false&storeNm=&storeId=0&searchDt=${endDt}`;
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
    // 라이브 관찰 시엔 UI 기본값인 "오늘 하루"(startDt=endDt)만 확인했으므로, 월 전체 범위
    // (월초~월말)를 넘겼을 때도 정상 동작하는지는 첫 실행 결과로 확인이 필요합니다.
    const query = `page=1&perPage=500&storeNm=&storeId=&orderGb=&searchOrderGb=&searchStartDt=${startDt}&searchEndDt=${endDt}`;
    return getJson(cmsUrl, `/api/settlements/sales?${query}`, cookieHeader);
  }
  if (variant === "settleRange") {
    // 처갓집형 — dateType=SETTLE + fromDt~toDt. 마찬가지로 라이브 관찰 시엔 "오늘 하루"만
    // 확인했으므로 월 전체 범위 적용 결과는 첫 실행 후 확인이 필요합니다.
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
    getDashboard(variant.dashboard, cmsUrl, cookieHeader, endDt),
    getSettlements(variant.settlement, cmsUrl, cookieHeader, startDt, endDt),
    getJson(cmsUrl, `/api/stats/targetGroup?${targetGroupQuery}`, cookieHeader),
  ]);

  return { yearMonth, dashboard, settlementsSales, targetGroupStats, collectedAt: Date.now() };
}
