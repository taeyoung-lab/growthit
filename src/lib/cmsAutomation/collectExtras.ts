// 리포트 8개 섹션 중 기존 5개 호출(dashboard·정산·타겟그룹·매장관리·회원통계)만으로는 만들 수 없는
// 항목 — 앱(온라인)/오프라인 결제액, 앱사용율, 메뉴·성별연령 매출, 매장 이용료, 방문자, 쿠폰·이벤트,
// 회원 등급 추이, 주문 단위(요일·시간대·회원별 구매) 집계 — 을 CMS의 통계 API로 추가 수집합니다.
//
// 2026-10-05 영커피 CMS(표준형)를 Chrome에서 직접 열어 각 메뉴의 실제 네트워크 요청을 캡처하고, 같은
// 로그인 세션으로 2026-09 월 범위를 직접 호출해 응답 구조·수치를 확인한 엔드포인트만 씁니다:
//   /api/salesStats/store | item | genderAges | dailyStoreSales, /api/stats/visitor, /api/stats/coupon,
//   /api/memberLevelStatus, /api/couponType/store, /api/event, /api/order
// 처갓집(분리형 대시보드)은 구조가 달라 이 모듈을 건너뜁니다(collect.ts) — 샐러리아·브래덴코 등
// 나머지 표준형도 같은 경로를 시도하되, 섹션별로 실패해도(null) 전체 수집은 계속됩니다.
//
// 매출발생구분: 온라인(salesTp 962001) = 앱 + 배달플랫폼(배달의민족·쿠팡이츠·요기요 등), 오프라인(962002) = POS.
// 온라인 안의 채널 코드(963xxx, /api/code/sub/963): 963001 우리가잇다(=그로스잇 앱), 963002 배달의민족,
// 963003 쿠팡이츠, 963004 POS, 963005 요기요, 963006 DKY, 963007 NAVER, 963008 배달통.
// 담당자(2026-10-06) 확정: 그로스잇 매출액 = 매출통계의 앱결제액 = "우리가잇다"(963001) 실결제액(배달비 제외).
// 온라인 전체(배달플랫폼 포함)가 아님 — 그래서 각 매출 행에 `app`(963001만)을 따로 담고, 온라인 채널별 합계는
// `onlineChannels`로 저장해 배달앱 대비 비교에 씁니다.
//
// 개인정보: /api/order는 고객 이름·로그인ID가 섞인 원본이라 저장하지 않습니다. 주문 목록을 다 읽은 뒤
// 서버 메모리에서 (고객번호 cusId → 주문 수·결제액)으로만 집계하고, 요일·시간대 분포와 함께 돌려줍니다.

import { CmsAutomationError } from "./types";

type GetJson = (cmsUrl: string, path: string, cookieHeader: string) => Promise<unknown>;

// ── 결과 타입 ────────────────────────────────────────────────────────────────

export interface Split {
  ord: number; // 주문건수
  dc: number; // 할인
  pay: number; // 실결제액(배달비 제외)
}
export interface SalesSplit {
  total: Split;
  delivery: Split;
  pickup: Split;
  store: Split;
  reserve: Split;
}
export interface SalesRow {
  name: string; // 매장명 / 메뉴명 / "성별 연령대"
  storeId: number | null;
  itemCd: string | null; // 메뉴 행만. 같은 이름의 메뉴가 여러 코드로 존재하므로 병합·구분은 이 코드로 합니다.
  all: SalesSplit;
  online: SalesSplit | null; // 온라인 전체(앱+배달플랫폼, 962001)
  offline: SalesSplit | null; // 오프라인(POS, 962002)
  app: SalesSplit | null; // 우리가잇다(963001) = 그로스잇 앱결제액. 앱 매출이 없는 행은 null
}
export interface OnlineChannelRow {
  code: string; // 963001 …
  name: string; // 우리가잇다·배달의민족·쿠팡이츠 …
  split: SalesSplit;
  share: number; // 온라인 내 비중(%) — CMS가 계산한 값
}
export interface OrderAggregate {
  orderCount: number; // 취소 제외
  amount: number; // 취소 제외 순매출 합계(netSales)
  byDow: number[]; // 일~토 주문 수
  byDowAmount: number[];
  byHour: number[]; // 0~23시 주문 수
  byChannel: Record<string, number>; // 주문유형명(매장/배달/픽업 등) → 주문 수
  memberCount: number;
  pagesRead: number;
  truncated: boolean; // 시간/페이지 상한에 걸려 일부만 읽었으면 true
}

export interface CmsExtras {
  salesStore: SalesRow[] | null; // [0]이 "전체" 합계 행
  salesItem: SalesRow[] | null; // 결제액 상위 메뉴 최대 TOP_ITEMS개 (+ 전체 행)
  salesGenderAge: SalesRow[] | null;
  onlineChannels: OnlineChannelRow[] | null; // 온라인 채널(앱·배달플랫폼)별 합계
  dailyBrandSet: Record<string, number> | null; // 매장 이용료·적용 매장수·신규 매장 등 브랜드 요약
  visitors: { date: string; total: number; aos: number; ios: number }[] | null;
  coupons: { couponGb: string | null; issued: number; used: number; rate: number; dcAmt: number }[] | null;
  couponsByStore: { storeId: number | null; storeNm: string; issued: number; used: number; rate: number; dcAmt: number }[] | null;
  storeCoupons: { couponNm: string; couponTpNm: string; issuedCnt: number; recentIssuedDt: string | null; dcAmt: number }[] | null;
  events: { eventNm: string; eventTpNm: string; startDt: string; endDt: string; state: string }[] | null;
  memberLevels: { date: string; total: number; counts: number[] }[] | null;
  orders: OrderAggregate | null;
}

// 회원별 월간 구매 집계 — Firestore는 배열 안의 배열을 못 쓰므로 [cusId, 주문수, 결제액]을 한 줄로 이어 붙입니다.
export interface MemberOrderAgg {
  flat: number[];
  truncated: boolean;
}

export interface ExtrasResult {
  extras: CmsExtras;
  memberOrderAgg: MemberOrderAgg | null;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const TOP_ITEMS = 40;
const ONLINE = "962001";
const OFFLINE = "962002";
const APP_CHANNEL = "963001"; // 우리가잇다 = 그로스잇 앱
// /api/code/sub/963 조회가 안 될 때의 대비용 이름(영커피 확인값)
const CHANNEL_NAMES: Record<string, string> = {
  "963001": "우리가잇다",
  "963002": "배달의민족",
  "963003": "쿠팡이츠",
  "963004": "POS",
  "963005": "요기요",
  "963006": "DKY",
  "963007": "NAVER",
  "963008": "배달통",
};
const ORDER_STATUS = "351002,351004,351006,351007,351031,351040,351041";
const ORDER_PAGE_SIZE = 500;
const ORDER_MAX_PAGES = 300;
const ORDER_TIME_BUDGET_MS = 60_000;
const ORDER_CONCURRENCY = 4;
// 여러 섹션 중 하나가 CMS에서 오래 걸려도 전체 수집 시간을 끌지 않도록 섹션별 상한을 둡니다.
const SECTION_TIMEOUT_MS = 90_000;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function split(r: Record<string, unknown>, prefix: "total" | "delivery" | "pickup" | "store" | "reserve"): Split {
  return { ord: num(r[`${prefix}OrderCnt`]), dc: num(r[`${prefix}DcAmt`]), pay: num(r[`${prefix}PayAmt`]) };
}
function salesSplit(r: Record<string, unknown>): SalesSplit {
  return {
    total: split(r, "total"),
    delivery: split(r, "delivery"),
    pickup: split(r, "pickup"),
    store: split(r, "store"),
    reserve: split(r, "reserve"),
  };
}
function toSalesRow(raw: unknown, name: string): SalesRow {
  const r = rec(raw);
  const byTp = (tp: string) => {
    const hit = arr(r.salesStatsList).map(rec).find((x) => str(x.salesTp) === tp);
    return hit ? salesSplit(hit) : null;
  };
  return {
    name,
    storeId: typeof r.storeId === "number" ? r.storeId : null,
    itemCd: typeof r.itemCd === "string" || typeof r.itemCd === "number" ? String(r.itemCd) : null,
    all: salesSplit(r),
    online: byTp(ONLINE),
    offline: byTp(OFFLINE),
    app: null,
  };
}
// salesTp=962001&channel=963001로 조회한 응답 — 합계 필드 자체가 우리가잇다(앱) 값입니다.
function toAppSplit(raw: unknown): SalesSplit {
  return salesSplit(rec(raw));
}
const rowKey = (storeId: number | null, name: string) => `${storeId ?? ""}|${name}`;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 시간 초과(${SECTION_TIMEOUT_MS / 1000}초)`)), SECTION_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

// 세션 만료는 섹션 실패로 삼키지 않고 바깥(backfill.ts 등)이 구분해서 처리하도록 다시 던집니다.
async function section<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(fn(), label);
  } catch (e) {
    if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
    console.warn(`[collectExtras] ${label} 수집 실패:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── 섹션별 수집 ──────────────────────────────────────────────────────────────

const APP_FILTER = `salesTp=${ONLINE}&channel=${APP_CHANNEL}`;

async function fetchSalesStore(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const base = `page=1&perPage=500&startDt=${startDt}&endDt=${endDt}&storeId=0&timeTp=&period=1m`;
  const tail = "isStoreAdmin=false&sortColumn=&sortDir=";
  const [allJ, appJ] = await Promise.all([
    getJson(cmsUrl, `/api/salesStats/store?${base}&salesTp=&channel=&${tail}`, ck),
    // 앱(우리가잇다) 조회가 실패해도 전체 행은 살립니다 — app만 비어 있게 됩니다.
    getJson(cmsUrl, `/api/salesStats/store?${base}&${APP_FILTER}&${tail}`, ck).catch((e) => {
      if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
      console.warn("[collectExtras] 매장별 앱(우리가잇다) 매출 수집 실패:", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  const appByKey = new Map<string, SalesSplit>();
  for (const r of arr(rec(appJ).list)) {
    const o = rec(r);
    appByKey.set(rowKey(typeof o.storeId === "number" ? o.storeId : null, str(o.gubun)), toAppSplit(o));
  }
  return arr(rec(allJ).list).map((r) => {
    const row = toSalesRow(r, str(rec(r).gubun));
    row.app = appByKey.get(rowKey(row.storeId, row.name)) ?? null;
    return row;
  });
}

// 2026-10-06: 우지커피처럼 매장이 595개·월 주문이 78만 건인 대형 브랜드는 매장별 매출통계가 섹션 제한시간
// 안에 안 돌아와 salesStore가 통째로 비었고, 그러면 "전체 매출"(비중의 분모)과 앱결제액이 사라져
// 정산 합계(마이너스 값)로 잘못 대체되는 문제가 있었습니다. perPage=1이면 [0]이 "전체" 합계 행이라
// 매장 로우를 받지 않아 빠르므로, 매장별 조회가 실패했을 때 "전체" 행(전체+앱)만이라도 확보합니다.
async function fetchSalesTotalOnly(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const base = `page=1&perPage=1&startDt=${startDt}&endDt=${endDt}&storeId=0&timeTp=&period=1m`;
  const tail = "isStoreAdmin=false&sortColumn=&sortDir=";
  const [allJ, appJ] = await Promise.all([
    getJson(cmsUrl, `/api/salesStats/store?${base}&salesTp=&channel=&${tail}`, ck),
    getJson(cmsUrl, `/api/salesStats/store?${base}&${APP_FILTER}&${tail}`, ck).catch((e) => {
      if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
      return null;
    }),
  ]);
  const first = arr(rec(allJ).list)[0];
  if (!first) return null;
  const row = toSalesRow(first, str(rec(first).gubun) || "전체");
  const appFirst = arr(rec(appJ).list)[0];
  row.app = appFirst ? toAppSplit(appFirst) : null;
  return [row];
}

// 온라인 안의 채널별(우리가잇다·배달의민족·쿠팡이츠…) 합계 — 전체 행의 salesStatsList가 채널 단위로 쪼개집니다.
async function fetchOnlineChannels(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const q = `page=1&perPage=1&startDt=${startDt}&endDt=${endDt}&storeId=0&timeTp=&period=1m&salesTp=${ONLINE}&channel=&isStoreAdmin=false&sortColumn=&sortDir=`;
  const j = rec(await getJson(cmsUrl, `/api/salesStats/store?${q}`, ck));
  const total = rec(arr(j.list)[0]);
  let names = new Map<string, string>(Object.entries(CHANNEL_NAMES));
  try {
    const codes = await getJson(cmsUrl, "/api/code/sub/963", ck);
    const list = Array.isArray(codes) ? codes : arr(rec(codes).list);
    names = new Map(list.map(rec).map((c) => [str(c.codeId), str(c.codeName)] as [string, string]).filter(([id, nm]) => id && nm));
    for (const [k, v] of Object.entries(CHANNEL_NAMES)) if (!names.has(k)) names.set(k, v);
  } catch (e) {
    if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
  }
  return arr(total.salesStatsList)
    .map(rec)
    .map((o): OnlineChannelRow => {
      const code = str(o.salesTp);
      return { code, name: names.get(code) ?? code, split: salesSplit(o), share: num(o.totalSalesPer) };
    });
}

// 메뉴는 665개처럼 많아서 한 번에 받으면 1MB를 넘습니다 — 페이지 단위로 받아 상위만 남깁니다.
// 순위는 그로스잇 앱결제액(우리가잇다) 기준, 앱 매출이 같으면(0) 전체 결제액 기준입니다.
async function pageItems(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string, filter: string) {
  const rows: Record<string, unknown>[] = [];
  const perPage = 200;
  for (let page = 1; page <= 10; page++) {
    const q = `page=${page}&perPage=${perPage}&startDt=${startDt}&endDt=${endDt}&storeId=0&timeTp=&period=1m&${filter}&isStoreAdmin=false`;
    const j = rec(await getJson(cmsUrl, `/api/salesStats/item?${q}`, ck));
    const list = arr(j.list);
    for (const r of list) rows.push(rec(r));
    if (list.length < perPage || page * perPage >= num(j.totalCnt)) break;
  }
  return rows;
}

async function fetchSalesItem(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const [allRows, appRows] = await Promise.all([
    pageItems(getJson, cmsUrl, ck, startDt, endDt, "salesTp=&channel="),
    pageItems(getJson, cmsUrl, ck, startDt, endDt, APP_FILTER).catch((e) => {
      if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
      console.warn("[collectExtras] 메뉴별 앱(우리가잇다) 매출 수집 실패:", e instanceof Error ? e.message : e);
      return [] as Record<string, unknown>[];
    }),
  ]);
  // 영커피에는 이름이 같은 메뉴가 서로 다른 itemCd로 존재(예: 부드러운(미디움) 아메리카노 100019/100786)해
  // 이름으로 병합하면 앱 값이 중복 계상됩니다 — itemCd가 있으면 그걸로, 없으면 이름으로 짝지읍니다.
  const itemKey = (o: Record<string, unknown>) => (o.itemCd != null && o.itemCd !== "" ? `cd:${String(o.itemCd)}` : `nm:${str(o.gubun)}`);
  const appByKey = new Map<string, SalesSplit>();
  for (const o of appRows) appByKey.set(itemKey(o), toAppSplit(o));

  const rows: SalesRow[] = [];
  let totalRow: SalesRow | null = null;
  for (const o of allRows) {
    const row = toSalesRow(o, str(o.gubun));
    row.app = appByKey.get(itemKey(o)) ?? null;
    if (row.name === "전체") totalRow = row;
    else rows.push(row);
  }
  rows.sort((a, b) => (b.app?.total.pay ?? 0) - (a.app?.total.pay ?? 0) || b.all.total.pay - a.all.total.pay);
  return [...(totalRow ? [totalRow] : []), ...rows.slice(0, TOP_ITEMS)];
}

async function fetchGenderAge(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const q = `startDt=${startDt}&endDt=${endDt}&storeId=0&timeTp=&period=1m&type=gender&isStoreAdmin=false`;
  const j = rec(await getJson(cmsUrl, `/api/salesStats/genderAges?${q}`, ck));
  return arr(j.list).map((r) => {
    const o = rec(r);
    return toSalesRow(r, `${str(o.gubun)} ${str(o.gubun2)}`.trim());
  });
}

// 브랜드 요약(brandSet)만 필요합니다 — perPage=1로 매장×일자 로우(수천 건)는 받지 않습니다.
async function fetchDailyBrandSet(getJson: GetJson, cmsUrl: string, ck: string, yearMonth: string, startDt: string, endDt: string) {
  const q = `page=1&perPage=1&storeNm=&storeId=0&searchDt=${yearMonth}&isStoreAdmin=false&startDt=${startDt}&endDt=${endDt}`;
  const j = rec(await getJson(cmsUrl, `/api/salesStats/dailyStoreSales?${q}`, ck));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(j.brandSet))) if (typeof v === "number") out[k] = v;
  return out;
}

async function fetchVisitors(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const j = rec(await getJson(cmsUrl, `/api/stats/visitor?page=1&perPage=40&startDt=${startDt}&endDt=${endDt}`, ck));
  return arr(j.list).map((r) => {
    const o = rec(r);
    return { date: str(o.yyyymmdd), total: num(o.totalLoginCnt), aos: num(o.aosLoginCnt), ios: num(o.iosLoginCnt) };
  });
}

async function fetchCoupons(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const q = `page=1&perPage=500&key=coupon&keyword=&startDt=${startDt}&endDt=${endDt}&period=1m`;
  const j = rec(await getJson(cmsUrl, `/api/stats/coupon?${q}`, ck));
  return arr(j.list).map((r) => {
    const o = rec(r);
    return {
      couponGb: typeof o.couponGb === "string" ? o.couponGb : null, // null = 전체 합계 행
      issued: num(o.issuedCnt),
      used: num(o.usedCnt),
      rate: num(o.rate),
      dcAmt: num(o.dcAmt),
    };
  });
}

async function fetchCouponsByStore(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const q = `page=1&perPage=500&key=store&keyword=&startDt=${startDt}&endDt=${endDt}&period=1m`;
  const j = rec(await getJson(cmsUrl, `/api/stats/coupon?${q}`, ck));
  return arr(j.list).map((r) => {
    const o = rec(r);
    return {
      storeId: typeof o.storeId === "number" ? o.storeId : null, // null = 전체 합계 행
      storeNm: str(o.storeNm),
      issued: num(o.issuedCnt),
      used: num(o.usedCnt),
      rate: num(o.rate),
      dcAmt: num(o.dcAmt),
    };
  });
}

async function fetchStoreCoupons(getJson: GetJson, cmsUrl: string, ck: string) {
  const q = "page=1&perPage=500&couponGb=424005&couponTp=&useYn=&key=&keyword=";
  const j = rec(await getJson(cmsUrl, `/api/couponType/store?${q}`, ck));
  return arr(j.list).map((r) => {
    const o = rec(r);
    return {
      couponNm: str(o.couponNm),
      couponTpNm: str(o.couponTpNm),
      issuedCnt: num(o.issuedCnt),
      recentIssuedDt: typeof o.recentIssuedDt === "string" ? o.recentIssuedDt : null,
      dcAmt: num(o.dcAmt),
    };
  });
}

async function fetchEvents(getJson: GetJson, cmsUrl: string, ck: string) {
  const j = rec(await getJson(cmsUrl, "/api/event?eventTp=&state=&type=&keyword=", ck));
  return arr(j.list).map((r) => {
    const o = rec(r);
    return { eventNm: str(o.eventNm), eventTpNm: str(o.eventTpNm), startDt: str(o.startDt), endDt: str(o.endDt), state: str(o.state) };
  });
}

async function fetchMemberLevels(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const j = rec(await getJson(cmsUrl, `/api/memberLevelStatus?page=1&perPage=40&startDt=${startDt}&endDt=${endDt}&period=1m`, ck));
  return arr(j.list).map((r) => {
    const o = rec(r);
    const counts: number[] = [];
    for (let i = 1; i <= 10; i++) counts.push(num(o[`cusLevelCnt${i}`]));
    while (counts.length > 0 && counts[counts.length - 1] === 0) counts.pop();
    return { date: str(o.yyyymmdd), total: num(o.totalCusCnt), counts };
  });
}

// 주문 목록 전체(월 2만~수만 건)를 500건씩 읽어 서버 메모리에서만 집계합니다. 고객 이름·로그인ID는 쓰지
// 않고 버립니다. 시간/페이지 상한에 걸리면 읽은 만큼만으로 집계하고 truncated=true로 표시합니다.
async function fetchOrders(
  getJson: GetJson,
  cmsUrl: string,
  ck: string,
  startDt: string,
  endDt: string
): Promise<{ agg: OrderAggregate; members: MemberOrderAgg }> {
  const pageUrl = (page: number) =>
    `/api/order?page=${page}&perPage=${ORDER_PAGE_SIZE}&storeId=&storeName=&orderSt=${ORDER_STATUS}&key=&keyword=` +
    `&startDt=${startDt}+00:00&endDt=${endDt}+23:59&orderGb=&payTp=&cusLoginId=&isStoreAdmin=false&orderStType=list`;

  const startedAt = Date.now();
  const agg: OrderAggregate = {
    orderCount: 0,
    amount: 0,
    byDow: Array(7).fill(0),
    byDowAmount: Array(7).fill(0),
    byHour: Array(24).fill(0),
    byChannel: {},
    memberCount: 0,
    pagesRead: 0,
    truncated: false,
  };
  const members = new Map<number, [number, number]>();

  const consume = (list: unknown[]) => {
    for (const raw of list) {
      const o = rec(raw);
      if (str(o.orderStNm) === "주문취소") continue;
      const net = num(o.netSales);
      agg.orderCount += 1;
      agg.amount += net;
      const gb = str(o.orderGbNm) || "기타";
      agg.byChannel[gb] = (agg.byChannel[gb] ?? 0) + 1;
      // orderDt는 "YYYY-MM-DD HH:mm:ss"(CMS 현지시간) — 서버 시간대와 무관하게 문자열로 직접 해석합니다.
      const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/.exec(str(o.orderDt));
      if (m) {
        const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
        agg.byDow[dow] += 1;
        agg.byDowAmount[dow] += net;
        agg.byHour[Number(m[4])] += 1;
      }
      const cusId = typeof o.cusId === "number" ? o.cusId : null;
      if (cusId) {
        const cur = members.get(cusId) ?? [0, 0];
        cur[0] += 1;
        cur[1] += net;
        members.set(cusId, cur);
      }
    }
  };

  const first = rec(await getJson(cmsUrl, pageUrl(1), ck));
  consume(arr(first.list));
  agg.pagesRead = 1;
  const totalPages = Math.min(Math.ceil(num(first.totalCnt) / ORDER_PAGE_SIZE), ORDER_MAX_PAGES);
  if (Math.ceil(num(first.totalCnt) / ORDER_PAGE_SIZE) > ORDER_MAX_PAGES) agg.truncated = true;

  const queue: number[] = [];
  for (let p = 2; p <= totalPages; p++) queue.push(p);
  const worker = async () => {
    while (queue.length > 0) {
      if (Date.now() - startedAt > ORDER_TIME_BUDGET_MS) {
        agg.truncated = true;
        return;
      }
      const p = queue.shift()!;
      const j = rec(await getJson(cmsUrl, pageUrl(p), ck));
      consume(arr(j.list));
      agg.pagesRead += 1;
    }
  };
  await Promise.all(Array.from({ length: ORDER_CONCURRENCY }, () => worker()));

  agg.memberCount = members.size;
  const flat: number[] = [];
  members.forEach(([cnt, amt], id) => flat.push(id, cnt, amt));
  return { agg, members: { flat, truncated: agg.truncated } };
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

export async function collectExtras(
  getJson: GetJson,
  cmsUrl: string,
  cookieHeader: string,
  yearMonth: string,
  startDt: string,
  endDt: string
): Promise<ExtrasResult> {
  const ck = cookieHeader;
  const [
    salesStore,
    salesItem,
    salesGenderAge,
    onlineChannels,
    dailyBrandSet,
    visitors,
    coupons,
    couponsByStore,
    storeCoupons,
    events,
    memberLevels,
    ordersResult,
  ] = await Promise.all([
    section("매장별 매출통계", () => fetchSalesStore(getJson, cmsUrl, ck, startDt, endDt)).then(
      (full) => full ?? section("전체 매출 합계(매장별 조회 실패 대체)", () => fetchSalesTotalOnly(getJson, cmsUrl, ck, startDt, endDt))
    ),
    section("메뉴별 매출통계", () => fetchSalesItem(getJson, cmsUrl, ck, startDt, endDt)),
    section("성별/연령별 매출통계", () => fetchGenderAge(getJson, cmsUrl, ck, startDt, endDt)),
    section("온라인 채널별 매출", () => fetchOnlineChannels(getJson, cmsUrl, ck, startDt, endDt)),
    section("일자별 매장 매출(브랜드 요약)", () => fetchDailyBrandSet(getJson, cmsUrl, ck, yearMonth, startDt, endDt)),
    section("방문자 통계", () => fetchVisitors(getJson, cmsUrl, ck, startDt, endDt)),
    section("쿠폰 통계", () => fetchCoupons(getJson, cmsUrl, ck, startDt, endDt)),
    section("매장별 쿠폰 통계", () => fetchCouponsByStore(getJson, cmsUrl, ck, startDt, endDt)),
    section("가맹점 쿠폰관리", () => fetchStoreCoupons(getJson, cmsUrl, ck)),
    section("이벤트", () => fetchEvents(getJson, cmsUrl, ck)),
    section("회원등급현황", () => fetchMemberLevels(getJson, cmsUrl, ck, startDt, endDt)),
    section("주문조회 집계", () => fetchOrders(getJson, cmsUrl, ck, startDt, endDt)),
  ]);

  return {
    extras: {
      salesStore,
      salesItem,
      salesGenderAge,
      onlineChannels,
      dailyBrandSet,
      visitors,
      coupons,
      couponsByStore,
      storeCoupons,
      events,
      memberLevels,
      orders: ordersResult ? ordersResult.agg : null,
    },
    memberOrderAgg: ordersResult ? ordersResult.members : null,
  };
}
