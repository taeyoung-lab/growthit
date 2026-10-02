import { getAdminDb } from "@/lib/firebase/admin";
import { decryptCmsPassword } from "@/lib/cmsCredentials";
import { loginToCms } from "./login";
import { collectMonthlyData } from "./collect";
import type { BrandCredentials, BrandMonthlyData, ReportBrand } from "@/lib/types";

// 그로스잇 브랜드 백필(backfill) — 서비스 오픈일부터 전월까지의 과거 데이터를 한 번에 가져와
// brandMonthlyData에 반영합니다. 2026-10-01 확정 사항(화면 설계 질문지 7번) 그대로 구현했습니다:
// 화면④ 같은 리뷰 단계 없이 CMS 원본값을 바로 저장하고(overrides는 빈 값, published는 false),
// PPT는 만들지 않습니다 — 오직 전월대비(MoM) 비교용 기준 데이터를 쌓는 용도입니다.
//
// 서버리스 함수 시간 제한(현재 /api/brands/[id]/backfill의 maxDuration=60초) 안에 전체 기간을
// 다 못 끝낼 수 있으므로(브랜드에 따라 서비스 오픈일부터 전월까지 수십 개월일 수 있음), 한 번의
// 실행은 TIME_BUDGET_MS 예산 안에서 처리 가능한 만큼만 처리하고 중단합니다. 각 달을 수집할 때마다
// 즉시 brandMonthlyData에 쓰고 brand.backfill_completed_through를 그 달로 갱신하므로, 도중에
// 함수가 강제 종료되더라도 이미 처리한 달은 보존되고, 다음 호출은 backfill_completed_through
// 다음 달부터 이어서 처리합니다(브랜드 관리 화면의 "백필 이어하기" 버튼이 이 엔드포인트를
// 다시 호출하는 방식 — 완료될 때까지 몇 번이고 눌러도 안전합니다).

const TIME_BUDGET_MS = 45_000;

// 서비스 오픈일(YYYY-MM-DD)의 달부터 "전월"(당월 제외 — 당월은 아직 끝나지 않아 집계 의미가 없음)
// 까지의 연월(YYYY-MM) 목록을 오름차순으로 돌려줍니다.
function monthsFromOpenDateThroughLastMonth(serviceOpenDate: string): string[] {
  const [openYear, openMonth] = serviceOpenDate.slice(0, 7).split("-").map(Number);

  const now = new Date();
  let targetYear = now.getUTCFullYear();
  let targetMonth = now.getUTCMonth(); // getUTCMonth()는 0-based라 그대로 쓰면 "이번 달의 바로 앞 달"
  if (targetMonth === 0) {
    targetMonth = 12;
    targetYear -= 1;
  }

  const months: string[] = [];
  let y = openYear;
  let m = openMonth;
  while (y < targetYear || (y === targetYear && m <= targetMonth)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

export interface BackfillBatchResult {
  done: boolean; // true면 서비스 오픈일~전월 전체가 이번 호출로 완료됨
  processedMonths: string[]; // 이번 호출에서 실제로 처리한 연월 목록(빈 배열이면 더 처리할 달이 없었음)
}

export async function runBackfillBatch(brandId: string): Promise<BackfillBatchResult> {
  const startedAt = Date.now();
  const db = getAdminDb();
  const brandRef = db.collection("brands").doc(brandId);

  const [brandSnap, credsSnap] = await Promise.all([
    brandRef.get(),
    db.collection("brandCredentials").doc(brandId).get(),
  ]);
  if (!brandSnap.exists) throw new Error("대상 브랜드를 찾을 수 없습니다.");
  const brand = brandSnap.data() as ReportBrand;
  if (!brand.service_open_date) throw new Error("서비스 오픈일이 없는 브랜드는 백필 대상이 아닙니다.");
  if (!credsSnap.exists) throw new Error("저장된 CMS 계정 정보가 없습니다.");
  const creds = credsSnap.data() as BrandCredentials;

  const allMonths = monthsFromOpenDateThroughLastMonth(brand.service_open_date);
  const remaining = brand.backfill_completed_through
    ? allMonths.filter((m) => m > brand.backfill_completed_through!)
    : allMonths;

  if (remaining.length === 0) {
    await brandRef.update({ backfill_status: "COMPLETED", updated_at: Date.now() });
    return { done: true, processedMonths: [] };
  }

  await brandRef.update({ backfill_status: "IN_PROGRESS", updated_at: Date.now() });

  // 로그인은 이번 배치에서 단 한 번만 — 이후 각 달의 데이터 수집은 이 쿠키로 일반 fetch만 반복합니다
  // (login.ts 상단 주석 참고: 느린 건 헤드리스 브라우저 로그인 단계뿐, JSON API 호출 자체는 빠릅니다).
  const session = await loginToCms({
    cmsUrl: brand.cms_url,
    username: creds.cms_username,
    password: decryptCmsPassword(creds.cms_password_encrypted),
    phoneVerificationRequired: brand.phone_verification_required,
    fixedVerificationCode: creds.fixed_verification_code_encrypted
      ? decryptCmsPassword(creds.fixed_verification_code_encrypted)
      : null,
  }).catch(async (e) => {
    await brandRef.update({ backfill_status: "FAILED", updated_at: Date.now() });
    throw e;
  });

  const processed: string[] = [];
  for (const yearMonth of remaining) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break; // 시간 예산 초과 — 다음 호출에서 이어감

    const docId = `${brandId}_${yearMonth}`;
    try {
      const collected = await collectMonthlyData(brand.cms_url, session, yearMonth);
      const data: BrandMonthlyData = {
        id: docId,
        organization_id: brand.organization_id,
        brand_id: brandId,
        year_month: yearMonth,
        source: "BACKFILL",
        data: {
          dashboard: collected.dashboard,
          settlementsSales: collected.settlementsSales,
          targetGroupStats: collected.targetGroupStats,
        },
        overrides: {},
        published: false,
        collected_at: collected.collectedAt,
        collected_by: null,
        updated_at: Date.now(),
      };
      // eslint-disable-next-line no-await-in-loop -- 달 순서대로 진행 상황을 즉시 저장해야
      // 중간에 함수가 강제 종료돼도 이미 처리한 달이 보존됩니다(위 주석 참고).
      await db.collection("brandMonthlyData").doc(docId).set(data);
      // eslint-disable-next-line no-await-in-loop
      await brandRef.update({ backfill_completed_through: yearMonth, updated_at: Date.now() });
      processed.push(yearMonth);
    } catch (e) {
      // 한 달이 실패해도 그 이전까지는 이미 저장된 상태로 남겨두고, FAILED로 표시해 담당자가
      // 알아챌 수 있게 합니다 — "백필 이어하기"를 다시 누르면 실패한 달부터 재시도합니다.
      console.error(`[backfill] ${brandId} ${yearMonth} 수집 실패`, e);
      await brandRef.update({ backfill_status: "FAILED", updated_at: Date.now() });
      return { done: false, processedMonths: processed };
    }
  }

  const isDone = processed.length === remaining.length;
  await brandRef.update({
    // 시간 예산 초과로 다 못 끝냈으면 PENDING으로 남겨 "백필 이어하기"가 계속 보이게 합니다.
    backfill_status: isDone ? "COMPLETED" : "PENDING",
    updated_at: Date.now(),
  });
  return { done: isDone, processedMonths: processed };
}

