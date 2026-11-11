import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSuperAdmin, ApiAuthError } from "@/lib/adminAuthCheck";
import { collectAndStoreMonth } from "@/lib/cmsAutomation/collectAndStore";
import type { BrandAutoCollect, BrandCredentials, ReportBrand } from "@/lib/types";

// 자동 월간 수집(2026-10-07) — 매월 초, 활성 브랜드의 "전월" 데이터를 CMS에서 자동으로 수집해
// brandMonthlyData에 저장합니다(source "AUTO"). PPT 발행은 하지 않습니다(발행은 계속 담당자 요청 시).
//
// 실행 방식: vercel.json의 cron이 매월 초 며칠 동안 하루 한 번(12:30 KST 무렵) 이 주소를 호출하고, 한 번
// 호출 안에서 브랜드를 "하나 끝나면 다음 하나" 순서로 이어서 처리합니다. 로그인+수집이 브랜드당 최대 약
// 2분(대형 브랜드)이라, 다음 브랜드는 이번 실행의 경과 시간이 NEXT_BRAND_START_LIMIT_MS 미만일 때만 시작합니다
// (최악의 경우에도 maxDuration 안에 끝나도록). 시간이 모자라 못 한 브랜드는 다음 날 호출에서 이어서 합니다.
// 같은 실행에서 실패한 브랜드는 다시 시도하지 않고(다음 호출에서 최대 3회까지 재시도), 다 채웠으면 아무것도
// 하지 않고 끝납니다. 수집 결과는 브랜드 문서의 auto_collect에 남아 브랜드 관리 화면에 "00월 수집 완료"로 보입니다.
//
// 인증: Vercel Cron이 보내는 `Authorization: Bearer ${CRON_SECRET}`(환경변수 CRON_SECRET 필요) 또는
// 로그인한 슈퍼 관리자(수동 실행용 POST)만 호출할 수 있습니다.
export const maxDuration = 300;
export const runtime = "nodejs";

const MAX_ATTEMPTS = 3;
// 이번 실행 시작 후 이 시간(ms)이 지나면 새 브랜드를 시작하지 않음. 대형 브랜드 1곳이 최대 약 120초이므로
// 150초 + 120초 = 270초 < maxDuration(300초).
const NEXT_BRAND_START_LIMIT_MS = 150_000;
// 월별 수집·리포트 대상에서 제외하기로 확정한 브랜드(처갓집양념치킨: 분리형 CMS·정산 미발생, 2026-10-06 결정).
const EXCLUDED_CMS_HOSTS = ["cheogajip-cms.growthit.co.kr"];

function kstPrevYearMonth(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  let y = kst.getUTCFullYear();
  let m = kst.getUTCMonth(); // 0-based = 지난달의 1-based 월
  if (m === 0) {
    y -= 1;
    m = 12;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// 수집 시각(collected_at, ms)이 그 달의 마지막 날(KST) 이전이면 true — 월이 끝나기 전에 모은 부분 데이터입니다.
function isCollectedBeforeMonthEnd(collectedAt: unknown, yearMonth: string): boolean {
  if (typeof collectedAt !== "number") return false; // 시각을 모르면 기존처럼 건드리지 않음
  const [y, m] = yearMonth.split("-").map(Number);
  const monthEndKstMs = Date.UTC(y, m, 1) - 9 * 60 * 60 * 1000; // 다음 달 1일 00:00 KST
  return collectedAt < monthEndKstMs;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorize(req: NextRequest): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  if (hasCronSecret(req)) return { ok: true };
  try {
    await requireSuperAdmin(req);
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiAuthError) return { ok: false, res: NextResponse.json({ error: e.message }, { status: e.status === 403 ? 403 : 401 }) };
    throw e;
  }
}

// 이번 실행에서 처리할 브랜드를 고릅니다: 활성 + 계정 저장됨 + 제외 대상 아님 + 서비스 오픈 이후 +
// 백필스때 진행 중 아님 + 전월 데이터 없음 + (이번 달 실패가 3회 미만). 시도 횟수가 적은 브랜드 먼저.
async function pickBrand(yearMonth: string, onlyBrandId?: string | null, skipIds: Set<string> = new Set()) {
  const db = getAdminDb();
  const snap = await db.collection("brands").where("brand_status", "==", "ACTIVE").get();
  const candidates: { brand: ReportBrand; attempts: number }[] = [];
  for (const d of snap.docs) {
    const brand = { ...(d.data() as ReportBrand), id: d.id };
    if (onlyBrandId && brand.id !== onlyBrandId) continue;
    if (skipIds.has(brand.id)) continue; // 이번 실행에서 이미 처리(성공/실패)한 브랜드
    if (!brand.has_saved_credentials) continue;
    if (EXCLUDED_CMS_HOSTS.includes(hostOf(brand.cms_url))) continue;
    if (brand.service_open_date && brand.service_open_date.slice(0, 7) > yearMonth) continue; // 아직 오픈 전
    if (brand.service_open_date && (brand.backfill_status === "PENDING" || brand.backfill_status === "IN_PROGRESS")) continue;
    const ac = brand.auto_collect;
    const attempts = ac && ac.year_month === yearMonth ? ac.attempts : 0;
    if (ac && ac.year_month === yearMonth && ac.status === "SUCCESS") continue;
    if (attempts >= MAX_ATTEMPTS) continue;
    const existing = await db.collection("brandMonthlyData").doc(`${brand.id}_${yearMonth}`).get();
    // 수동 수집·백필로 이미 채워진 달은 건드리지 않음. 단, 월말 이전에 수집된 "진행 중 달" 부분 데이터
    // (2026-11-10 발견: 우지커피 2026-10이 월초 약 20%만 수집된 채 남아 자동 수집이 영구히 건너뜀)는
    // 확정 데이터가 아니므로 다시 수집 대상으로 봅니다.
    if (existing.exists && !isCollectedBeforeMonthEnd(existing.data()?.collected_at, yearMonth)) continue;
    candidates.push({ brand, attempts });
  }
  candidates.sort((a, b) => a.attempts - b.attempts || a.brand.created_at - b.brand.created_at);
  return { picked: candidates[0] ?? null, remaining: candidates.length };
}

async function run(req: NextRequest, onlyBrandId?: string | null, forcedYm?: string | null) {
  const auth = await authorize(req);
  if (!auth.ok) return auth.res;

  const yearMonth = forcedYm && /^\d{4}-\d{2}$/.test(forcedYm) ? forcedYm : kstPrevYearMonth();
  const startedAt = Date.now();
  const handled = new Set<string>();
  const results: { brand: string; ok: boolean; error?: string }[] = [];

  // 브랜드 하나가 끝나면(성공/실패) 다음 브랜드를 이어서 처리. 단일 브랜드 지정(onlyBrandId) 때는 한 번만.
  for (;;) {
    const { picked, remaining } = await pickBrand(yearMonth, onlyBrandId, handled);
    if (!picked) {
      return NextResponse.json({
        ok: true,
        year_month: yearMonth,
        done: true,
        message: results.length ? "이번 실행에서 수집 대상 브랜드를 모두 처리했습니다." : "수집할 브랜드가 없습니다.",
        results,
      });
    }
    handled.add(picked.brand.id);
    results.push(await collectOne(picked.brand, picked.attempts, yearMonth));
    if (onlyBrandId) break;
    if (remaining - 1 <= 0) continue; // 남은 후보 없음 → 다음 루프에서 done 응답
    if (Date.now() - startedAt >= NEXT_BRAND_START_LIMIT_MS) {
      return NextResponse.json({
        ok: true,
        year_month: yearMonth,
        done: false,
        message: "시간 제한 때문에 남은 브랜드는 다음 실행에서 이어서 처리합니다.",
        remaining: remaining - 1,
        results,
      });
    }
  }
  return NextResponse.json({ ok: results.every((r) => r.ok), year_month: yearMonth, results });
}

// 브랜드 한 곳 수집 + 결과(auto_collect) 기록.
async function collectOne(brand: ReportBrand, attempts: number, yearMonth: string): Promise<{ brand: string; ok: boolean; error?: string }> {
  const db = getAdminDb();
  const brandRef = db.collection("brands").doc(brand.id);
  const credsSnap = await db.collection("brandCredentials").doc(brand.id).get();
  const record = (patch: Partial<BrandAutoCollect> & { status: BrandAutoCollect["status"] }) =>
    brandRef.update({
      auto_collect: { year_month: yearMonth, attempts: attempts + 1, at: Date.now(), error: null, ...patch } satisfies BrandAutoCollect,
    });

  if (!credsSnap.exists) {
    await record({ status: "FAILED", attempts: MAX_ATTEMPTS, error: "저장된 CMS 계정 정보가 없습니다." });
    return { brand: brand.brand_name, ok: false, error: "계정 정보 없음" };
  }
  try {
    await collectAndStoreMonth({
      brandId: brand.id,
      brand,
      creds: credsSnap.data() as BrandCredentials,
      yearMonth,
      collectedBy: null,
      source: "AUTO",
    });
    await record({ status: "SUCCESS" });
    return { brand: brand.brand_name, ok: true };
  } catch (e) {
    const msg = (e instanceof Error ? `${e.name}: ${e.message}` : "알 수 없는 오류").slice(0, 240);
    console.error(`[collect-monthly] ${brand.brand_name} ${yearMonth} 실패`, e);
    await record({ status: "FAILED", error: msg }).catch(() => undefined);
    return { brand: brand.brand_name, ok: false, error: msg };
  }
}

// Vercel Cron은 GET으로 호출합니다.
export async function GET(req: NextRequest) {
  try {
    return await run(req);
  } catch (e) {
    console.error("[GET /api/cron/collect-monthly]", e);
    return NextResponse.json({ error: "자동 수집 실행에 실패했습니다." }, { status: 500 });
  }
}

// 슈퍼 관리자가 수동으로 한 번 더 돌릴 때: POST { brand_id?, year_month? } (지정하지 않으면 GET과 동일).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { brand_id?: string; year_month?: string };
    return await run(req, body.brand_id ?? null, body.year_month ?? null);
  } catch (e) {
    console.error("[POST /api/cron/collect-monthly]", e);
    return NextResponse.json({ error: "자동 수집 실행에 실패했습니다." }, { status: 500 });
  }
}
