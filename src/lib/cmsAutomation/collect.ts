import { CmsAutomationError } from "./types";
import type { CmsCollectionResult, CmsSession } from "./types";
import { parseFirstSheetRows } from "./xlsxLite";
import { settlementsRowsToJson } from "./settlementsExcel";
import { collectExtras, fetchAllPages } from "./collectExtras";

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
//
// 2026-10-02 (같은 날, 추가 상향 시도 — 한 차례 되돌렸다가 구조 개선 후 재상향): 2026-03이 45초에서도
// 4번 연속 동일하게 실패(실행시간 48.17~48.20초, 개선 추세 없음) — 2025-11과 달리 "가끔 느린" 게
// 아니라 "이 달은 구조적으로 45초보다 오래 걸린다"는 신호. 브래덴코 CMS에 직접 로그인해 재현한 결과
// 47.4초(HTTP 200, 정상 응답) 확인. 처음엔 이 값만 54초로 올렸다가, 매 실행마다 새로 로그인하는
// 오버헤드(3~6초)가 backfill.ts의 시간 예산 체크에 그대로 들어가 "시도조차 못 하고 즉시 중단"되는
// 더 나쁜 결과를 보고 일단 45초로 되돌렸었음. 이후 backfill.ts에 로그인 세션 재사용을 도입해(캐시된
// 쿠키가 유효하면 재로그인 없이 바로 CMS 호출) 이 문제의 근본 원인(로그인 오버헤드가 예산을 깎아먹는
// 것)을 해결했으므로, 캐시 재사용 경로에서는 이 값을 안전하게 다시 올릴 수 있음 — 45→54초로 재상향.
// (캐시가 없거나 만료된 실행은 로그인만 하고 끝내고 이 값을 아예 쓰지 않으므로 영향 없음 — backfill.ts
// 상단 주석 참고.) 54초는 여전히 HARD_LIMIT_MS(60초)-SAFETY_MARGIN_MS(5초)=55초 바로 아래 선이자,
// 2026-03 실측 47.4~48.2초 대비 약 6~7초 여유를 남긴 값.
//
// 2026-10-02 (54초도 한계로 드러남 — 60초가 플랫폼 한도라는 전제 자체가 틀렸던 것으로 판명):
// 2026-04 정산 조회가 54초 타임아웃을 2회 연속 동일하게 초과. "가끔 느린" 2025-11·2026-03과
// 달리 재시도로는 해결되지 않는 신호라, 브래덴코 CMS에 직접 재현 요청(동일 URL·쿠키)해 확인한
// 결과 56.1초(HTTP 200, 정상 응답 — 데이터는 옴, 단지 느릴 뿐) 소요. 이 시점에 "60초는 Vercel
// 서버리스 함수의 플랫폼 자체 한도"라는, 이 프로젝트가 처음부터 전제해온 가정이 틀렸다는 것을
// 확인함 — Vercel 공식 문서(Functions > Configuring Functions > Duration)상 Hobby 플랜도 Fluid
// Compute 기준 maxDuration을 기본/최대 300초(5분)까지 지원. 60초는 route.ts에 이 프로젝트가
// 초반에 임의로 넣어둔 값일 뿐이었음. 담당자 확인 후 route.ts의 maxDuration을 120초로,
// backfill.ts의 HARD_LIMIT_MS도 120초로 함께 상향 — 이 값(CMS_FETCH_TIMEOUT_MS)도 지금까지
// 관측된 월별 CMS 응답시간(45~56초) 대비 넉넉한 여유를 두고 110초로 재상향함. 세션 재사용
// 구조(backfill.ts 상단 주석 참고)는 그대로 유지 — 로그인 오버헤드를 매 실행 예산에서 계속
// 제거해주는 별도의 안전장치로 유효함.
export const CMS_FETCH_TIMEOUT_MS = 110_000;

export async function getJson(cmsUrl: string, path: string, cookieHeader: string): Promise<unknown> {
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
  if (res.status === 401 || res.status === 403) {
    // 2026-10-02: 로그인 세션 재사용 도입 — 캐시해둔 쿠키가 이미 만료됐을 때 backfill.ts가 "데이터
    // 수집 실패"가 아니라 "세션이 끊겼다"로 구분해서 처리할 수 있도록, 이 경우만 별도 종류의 에러로
    // 던집니다(브랜드 FAILED 처리 대신 캐시만 비우고 다음 실행에서 재로그인하도록 유도하기 위함).
    throw new CmsAutomationError(`CMS 세션이 만료됐거나 무효합니다 (${res.status}) — ${url}`, "SESSION_EXPIRED");
  }
  if (res.status === 504) {
    // 2026-10-02: 브래덴코 2026-06 정산 조회가 CMS_FETCH_TIMEOUT_MS(110초)와 무관하게 매번 정확히
    // 60초에 504로 끊기는 것을 직접 재현까지 포함해 3회 연속 확인 — CMS 서버/인프라 자체의
    // 게이트웨이 타임아웃이라, 저희 쪽 요청 타임아웃을 아무리 올려도 해결되지 않습니다(담당자 확인
    // 완료). backfill.ts가 이 경우만 구분해서 그 달을 건너뛰고 다음 달로 넘어가도록 별도 종류의
    // 에러로 던집니다(types.ts의 CmsAutomationError 주석 참고).
    throw new CmsAutomationError(`CMS 서버 게이트웨이 타임아웃 (504) — ${url}`, "GATEWAY_TIMEOUT");
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

// 2026-10-05: 정산 JSON API(/api/settlements/sales)가 CMS 게이트웨이 타임아웃(504)으로 실패하는
// 달(브래덴코 2026-06·2026-09 등 — 저희 타임아웃과 무관하게 CMS가 60초에 끊음)의 대체 경로.
// 같은 화면의 "엑셀받기" 버튼이 호출하는 POST /api/settlements/sales/download는 같은 달을 0.1~0.4초에
// xlsx로 돌려주는 것을 브래덴코(2025-11·2026-03·2026-04·2026-06·2026-09)·영커피(2026-09)에서
// 직접 확인했습니다. 다만 JSON과 100% 같지는 않고(영커피 2026-09 기준 매장 101개 중 2개가 마이너스
// 조정 때문에 다름), 서비스이용료 세부 내역 필드가 없어서 — JSON이 실패했을 때만 쓰는 대체 경로로
// 한정하고, 어느 경로로 받았는지는 settlementSource로 저장 데이터에 남깁니다.
// 표준형(searchTp=month 방식) 브랜드에서만 검증했으므로 샐러리아·처갓집 같은 변형 브랜드에는
// 적용하지 않습니다(getSettlementsWithFallback 참고).
async function getSettlementsExcel(cmsUrl: string, cookieHeader: string, endDt: string): Promise<unknown> {
  const url = new URL("/api/settlements/sales/download", cmsUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CMS_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify({
        url: "settlements/sales/download",
        searchTp: "month",
        storeNm: "",
        storeId: "",
        orderGb: "",
        searchOrderGb: "",
        searchDt: endDt,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CmsAutomationError(`CMS 세션이 만료됐거나 무효합니다 (${res.status}) — ${url}`, "SESSION_EXPIRED");
  }
  if (!res.ok) throw new Error(`CMS 정산 엑셀 다운로드 실패 (${res.status}) — ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return settlementsRowsToJson(parseFirstSheetRows(buf));
}

function isCmsTimeout(err: unknown): boolean {
  if (err instanceof CmsAutomationError) return err.step === "GATEWAY_TIMEOUT";
  // getJson이 우리 쪽 요청 타임아웃(CMS_FETCH_TIMEOUT_MS)에 걸렸을 때 던지는 일반 Error.
  return err instanceof Error && err.message.includes("응답 지연");
}

async function getSettlementsWithFallback(
  variant: SettlementVariant,
  cmsUrl: string,
  cookieHeader: string,
  startDt: string,
  endDt: string
): Promise<{ data: unknown; source: "JSON" | "EXCEL_FALLBACK" }> {
  try {
    return { data: await getSettlements(variant, cmsUrl, cookieHeader, startDt, endDt), source: "JSON" };
  } catch (err) {
    // 세션 만료는 대체 경로가 의미 없고, 표준형 외 변형은 엑셀 경로가 검증되지 않았습니다 —
    // 원래 에러를 그대로 던져 backfill.ts의 기존 처리(그 달 건너뛰기 등)가 유지되게 합니다.
    if (variant !== "standard" || !isCmsTimeout(err)) throw err;
    try {
      const data = await getSettlementsExcel(cmsUrl, cookieHeader, endDt);
      console.warn(`[collectMonthlyData] 정산 JSON이 CMS 타임아웃으로 실패해 엑셀 다운로드로 대체했습니다(${cmsUrl}, ${endDt}).`);
      return { data, source: "EXCEL_FALLBACK" };
    } catch (fallbackErr) {
      console.warn(`[collectMonthlyData] 정산 엑셀 대체 경로도 실패(${cmsUrl}, ${endDt}):`, fallbackErr);
      throw err;
    }
  }
}

// 2026-10-02 테스트_브래덴코 네트워크 탭에서 직접 확인(표준형 기준만 검증 — 처갓집/샐러리아는
// 아직 동일 경로에 이 엔드포인트가 있는지 라이브 확인 전). perPage=500으로 브랜드의 전체 매장을
// 한 번에 받아옵니다(브래덴코 91개 매장 기준 정상 동작 확인). storeSt(매장 상태 코드)는
// /api/code/sub/350에서 조회 가능 — 350001=정상, 350002=휴점, 350003=폐업, 350004=개점전이며,
// 기획 문서의 "미도입 매장" 판별 기준(displayYn===0 && storeSt==="350004")과 정확히 일치함을
// 확인했습니다.
async function getStoreManage(cmsUrl: string, cookieHeader: string): Promise<unknown> {
  // 2026-10-06: perPage=500 한 번만 받으면 매장이 500개를 넘는 브랜드(우지커피 약 590개, 처갓집 1,000개 이상)는
  // 매장 수가 500으로 잘려 나왔습니다 — totalCnt를 보고 모든 페이지를 받습니다. 또 매장 한 줄이 800바이트가 넘어
  // 저장 문서(1MB 한도)의 절반을 차지했으므로, 리포트가 쓰는 두 값(매장 상태 storeSt·노출 여부 displayYn)만 남깁니다.
  const PER = 500;
  const { rows, totalCnt } = await fetchAllPages(
    getJson,
    cmsUrl,
    cookieHeader,
    (page) =>
      `/api/storeManage?page=${page}&perPage=${PER}&type=storeNm&keyword=&region=&storeState=&stampYn=&displayYn=&isStoreAdmin=false&storeId=`,
    PER
  );
  const list = rows.map((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return { storeSt: o.storeSt ?? null, displayYn: o.displayYn ?? null };
  });
  return { totalCnt: Math.max(totalCnt, list.length), list };
}

// 정산 응답의 매장별 목록(list)은 대형 브랜드에서 20만 바이트를 넘고, 리포트는 합계(totalInfo)와 매장 수(totalCnt)만
// 씁니다 — 정산 결제액 상위 일부만 남겨 저장 문서 크기를 줄입니다(합계 값은 그대로).
function compactSettlements(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  const list = Array.isArray(d.list) ? (d.list as Record<string, unknown>[]) : [];
  if (list.length <= 30) return data;
  const top = [...list]
    .sort((x, y) => Number(y.itemPayAmount ?? 0) - Number(x.itemPayAmount ?? 0))
    .slice(0, 30);
  return { ...d, totalCnt: d.totalCnt ?? list.length, list: top };
}

// 2026-10-02 테스트_브래덴코 네트워크 탭에서 직접 확인(표준형 기준만 검증). 이 엔드포인트는
// targetGroupStats와 달리 월 집계가 아니라 date 파라미터 하루치 스냅샷만 반환하므로(일별 로우
// 목록이 아니라 그 날짜 기준 전체 회원 분포), 기존 targetGroupStats가 endDt(월말)를 쓰는 것과
// 같은 방식으로 월말 스냅샷을 그 달의 대표값으로 사용합니다. perPage=50은 성별(2)×연령대 조합이
// 브랜드별로 달라도 넉넉히 전부 커버하기 위한 값(브래덴코 기준 응답 행 수 대비 여유 있게 설정).
async function getMemberStats(cmsUrl: string, cookieHeader: string, endDt: string): Promise<unknown> {
  const query = `page=1&perPage=50&date=${endDt}`;
  return getJson(cmsUrl, `/api/stats/member?${query}`, cookieHeader);
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

  // 2026-10-02 (첫 배포 직후 발견·수정): storeManage/memberStats를 처음엔 위 3개 호출이 모두 끝난
  // "다음 단계"로 await해서 순차 실행했다가, 브래덴코 실수집 테스트에서 /api/brands/{id}/collect
  // 라우트가 504로 실패하는 걸 바로 확인했습니다 — 이 라우트의 maxDuration은 60초인데, 브래덴코
  // 정산 조회 자체가 이미 45~56초대(collect.ts 상단 CMS_FETCH_TIMEOUT_MS 연혁 주석 참고)라,
  // 거기에 신규 호출 2개를 "순서대로 추가 대기"시키면 총 소요시간이 60초를 넘겨버리는 구조였습니다.
  // 그래서 5개 호출을 전부 하나의 Promise.allSettled로 묶어 동시에 쏘도록 바꿨습니다 — 전체
  // 소요시간은 (순차 합이 아니라) 가장 느린 호출 1개 기준으로 돌아오므로, 기존 3개짜리 Promise.all과
  // 사실상 같은 총 소요시간을 유지합니다. 다만 dashboard/settlementsSales/targetGroupStats 3개는
  // 기존과 동일하게 "실패하면 전체 실패"(reject를 그대로 throw)로 유지하고, storeManage/memberStats
  // 2개만 실패를 허용(null + 경고 로그)합니다 — 처갓집(분리형 dashboard)·샐러리아(dateRange 정산)
  // 등 아직 이 두 엔드포인트가 라이브 검증되지 않은 변형 브랜드에서 404/500이 나더라도 기존
  // 3개 데이터 수집 자체는 그대로 성공하도록 하기 위함입니다.
  // 2026-10-05: 리포트 8개 섹션용 추가 통계(collectExtras.ts) — 처갓집형(분리형 대시보드)은 엔드포인트
  // 구조가 달라 건너뜁니다. 위 호출들과 같은 allSettled에 넣어 동시에 실행하므로 전체 소요시간은 가장
  // 느린 호출 기준 그대로이고, 실패해도(null) 기존 수집 결과에는 영향이 없습니다.
  const [dashboardResult, settlementsResult, targetGroupResult, storeManageResult, memberStatsResult, extrasResult] =
    await Promise.allSettled([
      getDashboard(variant.dashboard, cmsUrl, cookieHeader, yearMonth, endDt),
      getSettlementsWithFallback(variant.settlement, cmsUrl, cookieHeader, startDt, endDt),
      getJson(cmsUrl, `/api/stats/targetGroup?${targetGroupQuery}`, cookieHeader),
      getStoreManage(cmsUrl, cookieHeader),
      getMemberStats(cmsUrl, cookieHeader, endDt),
      variant.dashboard === "granular"
        ? Promise.resolve(null)
        : collectExtras(getJson, cmsUrl, cookieHeader, yearMonth, startDt, endDt),
    ]);

  if (dashboardResult.status === "rejected") throw dashboardResult.reason;
  if (settlementsResult.status === "rejected") throw settlementsResult.reason;
  if (targetGroupResult.status === "rejected") throw targetGroupResult.reason;

  if (storeManageResult.status === "rejected") {
    console.warn(`[collectMonthlyData] storeManage 수집 실패(${cmsUrl}, ${yearMonth}):`, storeManageResult.reason);
  }
  if (memberStatsResult.status === "rejected") {
    console.warn(`[collectMonthlyData] memberStats 수집 실패(${cmsUrl}, ${yearMonth}):`, memberStatsResult.reason);
  }

  if (extrasResult.status === "rejected") {
    console.warn(`[collectMonthlyData] extras 수집 실패(${cmsUrl}, ${yearMonth}):`, extrasResult.reason);
  }
  const extrasValue = extrasResult.status === "fulfilled" ? extrasResult.value : null;

  const storeManage = storeManageResult.status === "fulfilled" ? storeManageResult.value : null;
  const memberStats = memberStatsResult.status === "fulfilled" ? memberStatsResult.value : null;

  return {
    yearMonth,
    dashboard: dashboardResult.value,
    settlementsSales: compactSettlements(settlementsResult.value.data),
    settlementSource: settlementsResult.value.source,
    targetGroupStats: targetGroupResult.value,
    storeManage,
    memberStats,
    extras: extrasValue ? extrasValue.extras : null,
    memberOrderAgg: extrasValue ? extrasValue.memberOrderAgg : null,
    breakdown: extrasValue ? extrasValue.breakdown : null,
    collectedAt: Date.now(),
  };
}
