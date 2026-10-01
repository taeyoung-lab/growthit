import type { CmsCollectionResult, CmsSession } from "./types";

// 로그인 이후 데이터 수집 — 화면을 다시 띄우지 않고, 로그인으로 얻은 쿠키를 그대로 실어 CMS가
// 내부적으로 쓰는 JSON API를 직접 호출합니다(login.ts 상단 주석 참고 — 2026-10-01 청자다방
// 테스트계정으로 Chrome 네트워크 탭에서 직접 확인한 엔드포인트입니다).
//
// 확인된 엔드포인트 3개:
// - GET /api/dashboard        — 월조회(searchTp=month) 시 매출·주문수·전체/신규 회원수·매장별 매출 등
// - GET /api/settlements/sales — 수수료 실측값(PG수수료·서비스이용수수료·예상정산금). 월조회 모드가
//   있는 건 화면(매출 정산 페이지의 "일조회/월조회" 드롭다운)으로 확인했지만, searchTp=month 쿼리
//   파라미터 자체가 실제로 月 단위로 집계해 주는지는 아직 라이브로 확인 전입니다 — 처음 실행 시
//   결과를 꼭 확인하세요.
// - GET /api/stats/targetGroup — 화면상 "최근 N일" 형태의 일별 로우 목록(월 집계 모드 없음)이라,
//   끝 날짜(endDt)를 해당 월 말일로 주고 그 달에 해당하는 로우만 추려 쓰는 방식으로 호출합니다.
//
// 8개 브랜드가 동일 코드베이스 기반으로 추정되나, 브랜드별 실제 연동 전 반드시 한 번씩 확인이 필요합니다.

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
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

export async function collectMonthlyData(
  cmsUrl: string,
  session: CmsSession,
  yearMonth: string
): Promise<CmsCollectionResult> {
  const endDt = lastDayOfMonth(yearMonth);
  const { cookieHeader } = session;

  const dashboardQuery =
    `page=1&perPage=5&searchTp=month&isStoreAdmin=false&storeNm=&storeId=0&searchDt=${endDt}` +
    `&regionSalesTp=total&storeSalesTp=total&bestTp=cnt`;
  const settlementsQuery =
    `page=1&perPage=500&searchTp=month&storeNm=&storeId=&orderGb=&searchOrderGb=&searchDt=${endDt}`;
  const targetGroupQuery = `page=1&perPage=31&endDt=${endDt}`;

  const [dashboard, settlementsSales, targetGroupStats] = await Promise.all([
    getJson(cmsUrl, `/api/dashboard?${dashboardQuery}`, cookieHeader),
    getJson(cmsUrl, `/api/settlements/sales?${settlementsQuery}`, cookieHeader),
    getJson(cmsUrl, `/api/stats/targetGroup?${targetGroupQuery}`, cookieHeader),
  ]);

  return { yearMonth, dashboard, settlementsSales, targetGroupStats, collectedAt: Date.now() };
}

