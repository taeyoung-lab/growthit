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
  // 월 주문이 상한(ORDER_MAX_PAGES×500건)을 넘는 대형 브랜드는 월 전체에 고르게 퍼진 일부 페이지만 읽고,
  // 요일·시간대·유형 분포를 전체 주문 수(totalCnt)에 맞춰 늘려 "추정치"로 담습니다(sampled=true).
  sampled?: boolean;
  totalCnt?: number; // CMS가 알려준 월 전체 주문 건수(취소 포함)
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
  // 매장이 많은 브랜드는 매장별 로우를 전부 저장하면 문서 한도(1MB)를 넘으므로 상·하위 매장만 남깁니다.
  // 매장 수·앱 매출 발생 매장 수는 전체 기준으로 따로 담습니다.
  salesStoreMeta?: { totalStores: number; withAppStores: number; kept: number } | null;
  // 섹션별 수집 결과(성공/실패·소요시간·실패 사유). 데이터가 비었을 때 원인 파악용 — 개인정보 없음.
  diag?: { label: string; ok: boolean; ms: number; error?: string }[];
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
// 2026-10-06: 우지커피처럼 데이터가 비었을 때 "왜 비었는지"를 저장 데이터만으로 알 수 있도록, 섹션마다
// 성공 여부·소요시간·실패 사유를 diag에 남깁니다(실패 사유는 CMS 응답 문구 앞부분만 — 개인정보 없음).
type Diag = { label: string; ok: boolean; ms: number; error?: string };
async function section<T>(label: string, fn: () => Promise<T>, diag?: Diag[]): Promise<T | null> {
  const t0 = Date.now();
  try {
    const v = await withTimeout(fn(), label);
    diag?.push({ label, ok: true, ms: Date.now() - t0 });
    return v;
  } catch (e) {
    if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
    const msg = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e).slice(0, 200);
    console.warn(`[collectExtras] ${label} 수집 실패:`, msg);
    diag?.push({ label, ok: false, ms: Date.now() - t0, error: msg });
    return null;
  }
}

// 목록 API를 끝까지 읽습니다. CMS가 perPage 상한(예: 500)을 두면 첫 페이지만 받아 매장이 500개를 넘는
// 브랜드(우지커피 595개, 처갓집 1,000개 이상)가 잘렸습니다 — totalCnt를 보고 나머지 페이지를 이어 받습니다.
// pathFor(page)는 page 번호를 넣은 경로를 돌려줍니다. 한 번에 4페이지씩 병렬로 받고 MAX_LIST_PAGES에서 멈춥니다.
const MAX_LIST_PAGES = 20;
export async function fetchAllPages(
  getJson: GetJson,
  cmsUrl: string,
  ck: string,
  pathFor: (page: number) => string,
  perPage: number
): Promise<{ rows: unknown[]; totalCnt: number; first: Record<string, unknown> }> {
  const first = rec(await getJson(cmsUrl, pathFor(1), ck));
  const rows: unknown[] = [...arr(first.list)];
  const totalCnt = num(first.totalCnt);
  const lastPage = Math.min(Math.ceil(totalCnt / perPage), MAX_LIST_PAGES);
  for (let p = 2; p <= lastPage; p += 4) {
    const batch = Array.from({ length: Math.min(4, lastPage - p + 1) }, (_, i) => p + i);
    const res = await Promise.all(batch.map((pg) => getJson(cmsUrl, pathFor(pg), ck)));
    for (const r of res) rows.push(...arr(rec(r).list));
  }
  return { rows, totalCnt, first };
}

// ── 섹션별 수집 ──────────────────────────────────────────────────────────────

const APP_FILTER = `salesTp=${ONLINE}&channel=${APP_CHANNEL}`;

const STORE_KEEP_TOP = 100;
const STORE_KEEP_BOTTOM = 20;
const zeroSplit = (): SalesSplit => ({
  total: { ord: 0, dc: 0, pay: 0 },
  delivery: { ord: 0, dc: 0, pay: 0 },
  pickup: { ord: 0, dc: 0, pay: 0 },
  store: { ord: 0, dc: 0, pay: 0 },
  reserve: { ord: 0, dc: 0, pay: 0 },
});
// 매장 한 줄을 합계(total)만 남긴 가벼운 행으로 줄입니다 — 리포트의 매장 표는 매장별 앱결제액·주문 수·
// 전체 결제액만 쓰므로, 유형별(배달/픽업/매장/예약)·온라인/오프라인 세부는 "전체" 행에만 둡니다.
function slimStoreRow(r: SalesRow): SalesRow {
  const all = zeroSplit();
  all.total = r.all.total;
  const app = r.app ? zeroSplit() : null;
  if (app && r.app) app.total = r.app.total;
  return { name: r.name, storeId: r.storeId, itemCd: r.itemCd, all, online: null, offline: null, app };
}

async function fetchSalesStore(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const PER = 500;
  const tail = "isStoreAdmin=false&sortColumn=&sortDir=";
  const pathFor = (filter: string) => (page: number) =>
    `/api/salesStats/store?page=${page}&perPage=${PER}&startDt=${startDt}&endDt=${endDt}&storeId=0&timeTp=&period=1m&${filter}&${tail}`;
  const [allR, appR] = await Promise.all([
    fetchAllPages(getJson, cmsUrl, ck, pathFor("salesTp=&channel="), PER),
    // 앱(우리가잇다) 조회가 실패해도 전체 행은 살립니다 — app만 비어 있게 됩니다.
    fetchAllPages(getJson, cmsUrl, ck, pathFor(APP_FILTER), PER).catch((e) => {
      if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
      console.warn("[collectExtras] 매장별 앱(우리가잇다) 매출 수집 실패:", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  const appByKey = new Map<string, SalesSplit>();
  for (const r of arr(appR?.rows)) {
    const o = rec(r);
    appByKey.set(rowKey(typeof o.storeId === "number" ? o.storeId : null, str(o.gubun)), toAppSplit(o));
  }
  const rows = allR.rows.map((r) => {
    const row = toSalesRow(r, str(rec(r).gubun));
    row.app = appByKey.get(rowKey(row.storeId, row.name)) ?? null;
    return row;
  });
  const total = rows.find((r) => r.name === "전체") ?? null;
  const stores = rows.filter((r) => r.name !== "전체");
  const withApp = stores.filter((r) => (r.app?.total.pay ?? 0) > 0).sort((a, b) => (b.app?.total.pay ?? 0) - (a.app?.total.pay ?? 0));
  // 앱 매출이 있는 매장은 상위 N + 하위 M만 남기고(합 120개 이하면 전부), 앱 매출 없는 매장은 개수만 셉니다.
  const kept =
    withApp.length > STORE_KEEP_TOP + STORE_KEEP_BOTTOM
      ? [...withApp.slice(0, STORE_KEEP_TOP), ...withApp.slice(withApp.length - STORE_KEEP_BOTTOM)]
      : withApp;
  return {
    rows: [...(total ? [total] : []), ...kept.map(slimStoreRow)],
    meta: { totalStores: stores.length, withAppStores: withApp.length, kept: kept.length },
  };
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
  return { rows: [row], meta: null as { totalStores: number; withAppStores: number; kept: number } | null };
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

const COUPON_STORE_KEEP = 30;
async function fetchCouponsByStore(getJson: GetJson, cmsUrl: string, ck: string, startDt: string, endDt: string) {
  const PER = 500;
  const { rows } = await fetchAllPages(
    getJson,
    cmsUrl,
    ck,
    (page) => `/api/stats/coupon?page=${page}&perPage=${PER}&key=store&keyword=&startDt=${startDt}&endDt=${endDt}&period=1m`,
    PER
  );
  const all = rows.map((r) => {
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
  // 리포트는 사용 건수 상위 5개 매장만 씁니다 — 합계 행 + 상위 매장 일부만 저장해 문서 크기를 줄입니다.
  const total = all.filter((c) => c.storeId === null);
  const stores = all.filter((c) => c.storeId !== null).sort((x, y) => y.used - x.used || y.issued - x.issued);
  return [...total, ...stores.slice(0, COUPON_STORE_KEEP)];
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

// 주문 목록을 500건씩 읽어 서버 메모리에서만 집계합니다. 고객 이름·로그인ID는 쓰지 않고 버립니다.
// 2026-10-06 대형 브랜드(우지커피 월 78만 건) 대응:
//  - 읽기 순서를 "최신순 연속"이 아니라 월 전체에 고르게 퍼진 페이지 순서로 바꿨습니다. 시간 상한에 걸려
//    일부만 읽어도 월말 며칠에 쏠리지 않아 요일·시간대 분포가 한쪽으로 치우치지 않습니다.
//  - 상한(시간·페이지)에 걸리면 읽은 만큼으로 집계해 전체 주문 수에 맞춰 비율로 늘린 추정치를 돌려줍니다
//    (sampled=true). 예전에는 섹션 제한시간(90초)을 넘기면 읽은 것까지 통째로 버려 null이 됐습니다.
//  - 회원별 구매 집계(재구매율 등)는 일부 주문만으로는 맞지 않으므로 truncated=true로 표시해 둡니다.
function spreadOrder(totalPages: number): number[] {
  // 2..totalPages를 간격(stride)으로 건너뛰며 돌아 앞쪽부터 읽어도 월 전체를 고르게 덮습니다.
  const n = totalPages - 1;
  if (n <= 0) return [];
  let stride = Math.max(1, Math.round(n * 0.618));
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  while (gcd(stride, n) !== 1) stride += 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(2 + ((i * stride) % n));
  return out;
}

async function fetchOrdersMonth(
  getJson: GetJson,
  cmsUrl: string,
  ck: string,
  startDt: string,
  endDt: string
): Promise<{ agg: OrderAggregate; members: MemberOrderAgg }> {
  const pageUrl = (page: number) => orderUrl(page, ORDER_PAGE_SIZE, startDt, endDt);

  const startedAt = Date.now();
  const deadline = startedAt + ORDER_TIME_BUDGET_MS;
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

  let rowsRead = 0; // 취소 포함, 실제로 받은 주문 행 수 — 늘리는 비율 계산용
  const consume = (list: unknown[]) => {
    rowsRead += list.length;
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
  const totalCnt = num(first.totalCnt);
  agg.totalCnt = totalCnt;
  const wantPages = Math.ceil(totalCnt / ORDER_PAGE_SIZE);
  const totalPages = Math.min(wantPages, ORDER_MAX_PAGES);
  if (wantPages > ORDER_MAX_PAGES) agg.truncated = true;

  const queue = spreadOrder(totalPages);
  const worker = async () => {
    while (queue.length > 0) {
      if (Date.now() > deadline) {
        agg.truncated = true;
        return;
      }
      const p = queue.shift()!;
      try {
        consume(arr(rec(await getJson(cmsUrl, pageUrl(p), ck)).list));
        agg.pagesRead += 1;
      } catch (e) {
        if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
        agg.truncated = true; // 한 페이지 실패로 지금까지 읽은 것을 버리지 않습니다
      }
    }
  };
  // 마감 시각 + 여유 8초까지만 기다립니다 — 느린 페이지 하나가 섹션 제한시간(90초)을 넘겨 전부 버려지는 것을 막습니다.
  await Promise.race([
    Promise.all(Array.from({ length: ORDER_CONCURRENCY }, () => worker())),
    new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()) + 8_000)),
  ]);
  if (queue.length > 0) agg.truncated = true;

  // 일부만 읽었으면 요일·시간대·유형 분포를 월 전체 주문 수에 맞춰 늘립니다(추정치).
  if (agg.truncated && agg.orderCount > 0 && totalCnt > agg.orderCount) {
    const k = totalCnt / Math.max(1, rowsRead);
    const scale = (v: number) => Math.round(v * k);
    agg.sampled = true;
    agg.orderCount = scale(agg.orderCount);
    agg.amount = scale(agg.amount);
    agg.byDow = agg.byDow.map(scale);
    agg.byDowAmount = agg.byDowAmount.map(scale);
    agg.byHour = agg.byHour.map(scale);
    for (const key of Object.keys(agg.byChannel)) agg.byChannel[key] = scale(agg.byChannel[key]);
  }

  agg.memberCount = members.size;
  const flat: number[] = [];
  members.forEach(([cnt, amt], id) => flat.push(id, cnt, amt));
  return { agg, members: { flat, truncated: agg.truncated } };
}

const orderUrl = (page: number, perPage: number, from: string, to: string) =>
  `/api/order?page=${page}&perPage=${perPage}&storeId=&storeName=&orderSt=${ORDER_STATUS}&key=&keyword=` +
  `&startDt=${from}+00:00&endDt=${to}+23:59&orderGb=&payTp=&cusLoginId=&isStoreAdmin=false&orderStType=list`;

function rejectAfter(ms: number, msg: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}

// 2026-10-06 우지커피(월 78만 건): CMS에 "한 달 범위"로 주문을 요청하면 약 28초 뒤 HTTP 500으로 실패합니다(진단 기록으로
// 확인). 하루 범위로 나누면 CMS가 처리할 수 있는 크기가 되므로, 월 조회가 실패하거나 상한(15만 건)을 넘는 브랜드는
// 하루씩 나눠서 읽습니다. 하루마다 ① 건수만 먼저 받고(perPage=1) ② 그날 주문을 고르게 걸치는 최대 3페이지를 읽습니다.
//  - 요일별 주문 수 = 날짜별 CMS 건수의 합(표본이 아니라 실제 값, 취소 포함이라 취소 비율만큼 보정)
//  - 시간대·주문유형 분포와 평균 결제액 = 표본에서 계산해 전체 건수에 맞춰 늘린 추정치(sampled=true)
//  - 회원별 구매 집계는 표본뿐이라 truncated=true(재구매율 등은 표시하지 않음)
async function fetchOrdersDaily(
  getJson: GetJson,
  cmsUrl: string,
  ck: string,
  startDt: string,
  endDt: string
): Promise<{ agg: OrderAggregate; members: MemberOrderAgg }> {
  const days: string[] = [];
  for (let d = new Date(`${startDt}T00:00:00Z`); d <= new Date(`${endDt}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const deadline = Date.now() + ORDER_TIME_BUDGET_MS;
  const dayTotal = new Map<string, number>(); // 날짜 → CMS가 알려준 건수(취소 포함)
  const members = new Map<number, [number, number]>();
  const hourN: number[] = Array(24).fill(0);
  const chanN: Record<string, number> = {};
  const dowSample = Array.from({ length: 7 }, () => ({ n: 0, amt: 0 }));
  let sampleN = 0; // 취소 제외 표본 수
  let sampleAmt = 0;
  let rowsRead = 0; // 취소 포함 표본 행 수
  let pagesRead = 0;

  const consume = (list: unknown[]) => {
    rowsRead += list.length;
    for (const raw of list) {
      const o = rec(raw);
      if (str(o.orderStNm) === "주문취소") continue;
      const net = num(o.netSales);
      sampleN += 1;
      sampleAmt += net;
      const gb = str(o.orderGbNm) || "기타";
      chanN[gb] = (chanN[gb] ?? 0) + 1;
      const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/.exec(str(o.orderDt));
      if (m) {
        const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
        dowSample[dow].n += 1;
        dowSample[dow].amt += net;
        hourN[Number(m[4])] += 1;
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

  const CONC = 6;
  let next = 0;
  let dayIdx = 0;
  const worker = async () => {
    while (next < days.length) {
      if (Date.now() > deadline) return;
      const day = days[next++];
      try {
        const head = rec(await getJson(cmsUrl, orderUrl(1, 1, day, day), ck));
        const total = num(head.totalCnt);
        dayTotal.set(day, total);
        const pages = Math.ceil(total / ORDER_PAGE_SIZE);
        if (pages === 0) continue;
        // 읽을 페이지: 3페이지 이하면 전부, 아니면 하루에 고르게 걸치되 날짜마다 위치를 달리해 한 시간대에 쏠리지 않게 합니다.
        const picks = new Set<number>();
        if (pages <= 3) for (let p = 1; p <= pages; p++) picks.add(p);
        else {
          const off = (dayIdx++ % 3) / 3; // 0, 1/3, 2/3
          for (let k = 0; k < 3; k++) picks.add(Math.min(pages, Math.max(1, Math.floor(((k + 0.5 + off * 0.9) / 3) * pages) + 1)));
        }
        for (const p of picks) {
          if (Date.now() > deadline) break;
          consume(arr(rec(await getJson(cmsUrl, orderUrl(p, ORDER_PAGE_SIZE, day, day), ck)).list));
          pagesRead += 1;
        }
      } catch (e) {
        if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
        // 그날은 건너뜁니다 — 다른 날 결과는 살립니다
      }
    }
  };
  await Promise.race([
    Promise.all(Array.from({ length: CONC }, () => worker())),
    new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()) + 8_000)),
  ]);
  if (sampleN === 0 || dayTotal.size === 0) throw new Error("일 단위 주문 조회에서 읽은 주문이 없습니다");

  const totalAll = [...dayTotal.values()].reduce((a, b) => a + b, 0);
  const keep = rowsRead > 0 ? sampleN / rowsRead : 1; // 취소 제외 비율
  const orderCount = Math.round(totalAll * keep);
  const meanAll = sampleAmt / sampleN;
  const byDow: number[] = Array(7).fill(0);
  const byDowAmount: number[] = Array(7).fill(0);
  for (const [day, n] of dayTotal) {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    byDow[dow] += n * keep;
  }
  for (let i = 0; i < 7; i++) {
    const mean = dowSample[i].n > 0 ? dowSample[i].amt / dowSample[i].n : meanAll;
    byDowAmount[i] = Math.round(byDow[i] * mean);
    byDow[i] = Math.round(byDow[i]);
  }
  const k = sampleN > 0 ? orderCount / sampleN : 1;
  const byChannel: Record<string, number> = {};
  for (const key of Object.keys(chanN)) byChannel[key] = Math.round(chanN[key] * k);

  const agg: OrderAggregate = {
    orderCount,
    amount: Math.round(orderCount * meanAll),
    byDow,
    byDowAmount,
    byHour: hourN.map((v) => Math.round(v * k)),
    byChannel,
    memberCount: 0,
    pagesRead,
    truncated: true,
    sampled: true,
    totalCnt: totalAll,
  };
  // 회원별 구매 집계는 표본(전체의 일부)으로는 재구매율·빈도가 실제보다 크게 낮게 나오므로 저장하지 않습니다(빈 집계).
  // 리포트의 "회원 구매 행동" 섹션은 "집계 데이터가 없습니다"로 표시됩니다.
  void members;
  return { agg, members: { flat: [], truncated: true } };
}

// 월 범위로 먼저 건수만 물어봅니다(10초 안에 못 받으면 대형 브랜드로 보고 일 단위로 읽습니다).
async function fetchOrders(
  getJson: GetJson,
  cmsUrl: string,
  ck: string,
  startDt: string,
  endDt: string
): Promise<{ agg: OrderAggregate; members: MemberOrderAgg }> {
  let probe: number | null = null;
  try {
    const j = rec(await Promise.race([getJson(cmsUrl, orderUrl(1, 1, startDt, endDt), ck), rejectAfter(10_000, "월 범위 주문 건수 조회 지연")]));
    probe = num(j.totalCnt);
  } catch (e) {
    if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") throw e;
    probe = null;
  }
  if (probe !== null && probe <= ORDER_MAX_PAGES * ORDER_PAGE_SIZE) return fetchOrdersMonth(getJson, cmsUrl, ck, startDt, endDt);
  return fetchOrdersDaily(getJson, cmsUrl, ck, startDt, endDt);
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
  const diag: Diag[] = [];
  const [
    salesStoreResult,
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
    section("매장별 매출통계", () => fetchSalesStore(getJson, cmsUrl, ck, startDt, endDt), diag).then(
      (full) =>
        full ?? section("전체 매출 합계(매장별 조회 실패 대체)", () => fetchSalesTotalOnly(getJson, cmsUrl, ck, startDt, endDt), diag)
    ),
    section("메뉴별 매출통계", () => fetchSalesItem(getJson, cmsUrl, ck, startDt, endDt), diag),
    section("성별/연령별 매출통계", () => fetchGenderAge(getJson, cmsUrl, ck, startDt, endDt), diag),
    section("온라인 채널별 매출", () => fetchOnlineChannels(getJson, cmsUrl, ck, startDt, endDt), diag),
    section("일자별 매장 매출(브랜드 요약)", () => fetchDailyBrandSet(getJson, cmsUrl, ck, yearMonth, startDt, endDt), diag),
    section("방문자 통계", () => fetchVisitors(getJson, cmsUrl, ck, startDt, endDt), diag),
    section("쿠폰 통계", () => fetchCoupons(getJson, cmsUrl, ck, startDt, endDt), diag),
    section("매장별 쿠폰 통계", () => fetchCouponsByStore(getJson, cmsUrl, ck, startDt, endDt), diag),
    section("가맹점 쿠폰관리", () => fetchStoreCoupons(getJson, cmsUrl, ck), diag),
    section("이벤트", () => fetchEvents(getJson, cmsUrl, ck), diag),
    section("회원등급현황", () => fetchMemberLevels(getJson, cmsUrl, ck, startDt, endDt), diag),
    section("주문조회 집계", () => fetchOrders(getJson, cmsUrl, ck, startDt, endDt), diag),
  ]);

  return {
    extras: {
      salesStore: salesStoreResult ? salesStoreResult.rows : null,
      salesStoreMeta: salesStoreResult ? salesStoreResult.meta : null,
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
      diag,
    },
    memberOrderAgg: ordersResult ? ordersResult.members : null,
  };
}
