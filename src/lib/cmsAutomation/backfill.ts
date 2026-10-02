import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { decryptCmsPassword, encryptCmsPassword } from "@/lib/cmsCredentials";
import { loginToCms } from "./login";
import { collectMonthlyData, CMS_FETCH_TIMEOUT_MS } from "./collect";
import { CmsAutomationError } from "./types";
import type { BrandCredentials, BrandMonthlyData, ReportBrand } from "@/lib/types";

// 2026-10-02: 로그인 세션 재사용 — "백필 이어하기"를 누를 때마다 매번 새 서버 실행(invocation)이
// 시작되고, 그때마다 헤드리스 브라우저로 처음부터 다시 로그인(3~6초)하다 보니 60초 서버리스 시간
// 제한 안에서 느린 CMS 호출(2026-03 실측 47.4~48.2초)에 쓸 수 있는 여유가 거의 안 남는 문제가 있었음
// (CMS_FETCH_TIMEOUT_MS를 54초로 올려봤다가 "로그인 오버헤드를 셈에 넣지 않아 시도조차 못 하고
// 즉시 중단"되는 더 나쁜 결과를 보고 되돌린 사건 — collect.ts 상단 주석 참고). 로그인으로 얻은 쿠키를
// brandCredentials에 암호화해 캐시해두고, 이 TTL 안이면 다음 실행이 로그인을 건너뛰고 바로 재사용합니다.
// 정확한 CMS 세션 유효기간은 확인된 바 없어(길게는 수십 분 이상 유지되는 것을 관찰함) 보수적으로
// 잡았고, 혹시 이보다 일찍 끊기더라도 getJson()이 401/403을 SESSION_EXPIRED로 구분해 던지므로 그
// 자리에서 캐시를 비우고 다음 실행이 재로그인하도록 안전하게 넘어갑니다(아래 catch 블록 참고).
const SESSION_CACHE_TTL_MS = 20 * 60 * 1000; // 20분

// 그로스잇 브랜드 백필(backfill) — 서비스 오픈일부터 전월까지의 과거 데이터를 한 번에 가져와
// brandMonthlyData에 반영합니다. 2026-10-01 확정 사항(화면 설계 질문지 7번) 그대로 구현했습니다:
// 화면④ 같은 리뷰 단계 없이 CMS 원본값을 바로 저장하고(overrides는 빈 값, published는 false),
// PPT는 만들지 않습니다 — 오직 전월대비(MoM) 비교용 기준 데이터를 쌓는 용도입니다.
//
// 서버리스 함수 시간 제한(현재 /api/brands/[id]/backfill의 maxDuration=60초, HARD_LIMIT_MS) 안에
// 전체 기간을 다 못 끝낼 수 있으므로(브랜드에 따라 서비스 오픈일부터 전월까지 수십 개월일 수 있음),
// 한 번의 실행은 처리 가능한 만큼만 처리하고 안전하게 중단합니다. 각 달을 수집할 때마다 즉시
// brandMonthlyData에 쓰고 brand.backfill_completed_through를 그 달로 갱신하므로, 도중에 함수가
// 강제 종료되더라도 이미 처리한 달은 보존되고, 다음 호출은 backfill_completed_through 다음 달부터
// 이어서 처리합니다(브랜드 관리 화면의 "백필 이어하기" 버튼이 이 엔드포인트를 다시 호출하는 방식 —
// 완료될 때까지 몇 번이고 눌러도 안전합니다).
//
// 2026-10-02: 처음엔 TIME_BUDGET_MS=45초를 고정값으로 "달 시작 전"에만 체크했는데, 브래덴코
// CMS 응답이 느려(42개 매장 집계) collect.ts의 요청별 타임아웃(CMS_FETCH_TIMEOUT_MS)을 15초→30초로
// 올리고 나니 — 로그인+2개월 완료가 45초 budget 안에 들어와 3번째 달을 시작했는데, 그 달이 30초
// 타임아웃을 꽉 채우면서 합계가 60초 하드 리밋을 넘겨 또 504(Vercel 강제종료)가 발생함. 즉
// TIME_BUDGET_MS와 CMS_FETCH_TIMEOUT_MS가 서로 안 맞물려 있으면 타임아웃을 올릴 때마다 같은 사고가
// 재발함. 그래서 "달 시작 전" 체크를 고정 예산이 아니라 "지금 시작하면 최악의 경우(이번 달이
// CMS_FETCH_TIMEOUT_MS를 꽉 채움)에도 하드 리밋 전에 안전하게 끝나는가"로 바꿈 — collect.ts의
// 타임아웃 값이 나중에 또 바뀌어도 이 계산식이 자동으로 따라가므로 같은 실수가 반복되지 않습니다.
// 2026-10-02: 60초는 Vercel 플랫폼 한도가 아니라 이 프로젝트가 초반에 임의로 넣어둔 값이었음
// (공식 문서 확인 결과 Hobby 플랜도 Fluid Compute 기준 300초까지 지원 — route.ts 상단 주석 참고).
// 브래덴코 2026-04가 54초 타임아웃도 일관되게 초과(재현 측정 56.1초)해 120초로 상향(담당자 확인).
const HARD_LIMIT_MS = 120_000; // route.ts의 maxDuration과 일치시켜야 함
const SAFETY_MARGIN_MS = 5_000; // Firestore 쓰기·응답 반환에 쓸 여유 시간

// 2026-10-02 (같은 날, 위 120초 상향 직후): 브래덴코 2026-06 정산 조회는 타임아웃을 아무리 올려도
// 해결되지 않는 종류의 실패였음 — CMS_FETCH_TIMEOUT_MS(110초)와 무관하게 CMS 서버 자체가 매번
// 정확히 60초에 504를 돌려줌(직접 재현까지 포함해 3회 연속 확인, 담당자 확인 완료). 이런 "CMS
// 서버 자체의 게이트웨이 타임아웃"(collect.ts의 getJson이 GATEWAY_TIMEOUT으로 구분해서 던짐)은
// 아래 for 루프에서 그 달을 backfill_skipped_months에 기록하고 건너뛴 뒤 다음 달부터 계속
// 진행합니다 — 그 외의 일반 실패(COLLECT 등)는 기존대로 FAILED로 멈추고 담당자가 "백필
// 이어하기"로 재시도하도록 그대로 둡니다(원인을 알 수 없는 새로운 종류의 실패까지 자동으로
// 건너뛰어 버리면 진짜 고쳐야 할 버그를 놓칠 수 있으므로, 건너뛰기는 확인된 이 에러 종류로만 한정).

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
  // 이번 호출에서 GATEWAY_TIMEOUT으로 건너뛴 연월 목록(위 HARD_LIMIT_MS 주석 참고) — 브랜드 관리
  // 화면에서 "이번 실행에서 N개월 처리함" 메시지에 함께 보여주기 위함.
  skippedMonths: string[];
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
    return { done: true, processedMonths: [], skippedMonths: [] };
  }

  await brandRef.update({ backfill_status: "IN_PROGRESS", updated_at: Date.now() });

  const credsRef = db.collection("brandCredentials").doc(brandId);

  // 캐시된 세션이 있고 TTL 안이면 로그인을 건너뛰고 바로 재사용합니다 — 이번 실행은 거의 전부를
  // 느린 CMS 호출에 쓸 수 있습니다(아래 for 루프의 시간 예산 체크가 startedAt 기준이라, 로그인을
  // 건너뛴 만큼 그대로 여유로 남습니다).
  const cachedCookie = creds.cms_session_cookie_encrypted;
  const cachedAt = creds.cms_session_cached_at;
  const hasValidCache = !!cachedCookie && !!cachedAt && Date.now() - cachedAt < SESSION_CACHE_TTL_MS;

  if (!hasValidCache) {
    // 캐시가 없거나 만료 — 이번 실행은 로그인만 하고 끝냅니다(어떤 달도 시도하지 않음). 로그인
    // (3~6초)과 느린 CMS 호출(최악의 경우 CMS_FETCH_TIMEOUT_MS 꽉 채움)이 같은 실행에 몰리면 60초
    // 하드 리밋에 바짝 붙는 상황이 재발하므로, 아예 한 실행씩 분리합니다 — "백필 이어하기"를
    // 한 번 더 눌러야 할 수 있지만, 그만큼 타임아웃 설정을 안전하게 유지할 수 있습니다.
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

    await credsRef.update({
      cms_session_cookie_encrypted: encryptCmsPassword(session.cookieHeader),
      cms_session_cached_at: Date.now(),
    });
    // 아직 어떤 달도 처리하지 않았으니 "대기" 상태로 남겨 "백필 이어하기"가 계속 보이게 합니다.
    await brandRef.update({ backfill_status: "PENDING", updated_at: Date.now() });
    return { done: false, processedMonths: [], skippedMonths: [] };
  }

  const session = { cookieHeader: decryptCmsPassword(cachedCookie!) };
  const processed: string[] = [];
  const skipped: string[] = [];
  for (const yearMonth of remaining) {
    // 지금 이 달을 시작했을 때 최악의 경우(= collect.ts 쪽 요청이 CMS_FETCH_TIMEOUT_MS를 꽉 채움)에도
    // 하드 리밋 전에 안전하게 끝나는지로 판단 — 고정 예산이 아니라 실제 타임아웃 값에 연동된 계산식.
    if (Date.now() - startedAt + CMS_FETCH_TIMEOUT_MS > HARD_LIMIT_MS - SAFETY_MARGIN_MS) break;

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
      if (e instanceof CmsAutomationError && e.step === "SESSION_EXPIRED") {
        // 캐시해둔 세션이 실제로는 이미 무효했던 경우 — 데이터 수집 "실패"가 아니라 세션 문제이므로
        // FAILED로 담당자를 놀라게 하지 않고, 캐시만 비운 뒤 "대기"로 남겨 다음 "백필 이어하기"가
        // 자동으로 재로그인하도록 합니다.
        console.warn(`[backfill] ${brandId} ${yearMonth} 캐시된 세션 만료 감지 — 캐시 비우고 재로그인 예정`, e);
        await credsRef.update({ cms_session_cookie_encrypted: null, cms_session_cached_at: null });
        await brandRef.update({ backfill_status: "PENDING", updated_at: Date.now() });
        return { done: false, processedMonths: processed, skippedMonths: skipped };
      }
      if (e instanceof CmsAutomationError && e.step === "GATEWAY_TIMEOUT") {
        // 2026-10-02: CMS 서버 자체의 게이트웨이 타임아웃(저희 쪽 타임아웃 설정과 무관 — collect.ts
        // 주석 참고)이라 재시도해도 해결되지 않을 가능성이 높음을 담당자가 직접 재현 결과로 확인하고,
        // 이 달은 건너뛰고 다음 달부터 계속 진행하기로 결정함. backfill_completed_through는 그대로
        // 이 달로 전진시켜(그래야 다음 호출이 이 달에서 계속 멈추지 않음) 다음 달부터 이어가고,
        // 어떤 달을 건너뛰었는지는 backfill_skipped_months에 남겨 브랜드 관리 화면에서 보이게 합니다.
        console.warn(`[backfill] ${brandId} ${yearMonth} CMS 게이트웨이 타임아웃 — 건너뛰고 계속 진행`, e);
        skipped.push(yearMonth);
        // eslint-disable-next-line no-await-in-loop -- 위 성공 경로와 동일하게, 중간에 함수가
        // 강제 종료돼도 건너뛴 기록이 보존되도록 즉시 씁니다.
        await brandRef.update({
          backfill_completed_through: yearMonth,
          backfill_skipped_months: FieldValue.arrayUnion(yearMonth),
          updated_at: Date.now(),
        });
        continue;
      }
      // 한 달이 실패해도 그 이전까지는 이미 저장된 상태로 남겨두고, FAILED로 표시해 담당자가
      // 알아챌 수 있게 합니다 — "백필 이어하기"를 다시 누르면 실패한 달부터 재시도합니다.
      console.error(`[backfill] ${brandId} ${yearMonth} 수집 실패`, e);
      await brandRef.update({ backfill_status: "FAILED", updated_at: Date.now() });
      return { done: false, processedMonths: processed, skippedMonths: skipped };
    }
  }

  // GATEWAY_TIMEOUT으로 건너뛴 달도 "이번 배치에서 처리(= remaining에서 소진)"한 것으로 쳐야
  // 진행률 판단(done 여부)이 맞습니다 — 그 달 자체는 데이터가 없지만, 더 이상 막혀있지 않습니다.
  const isDone = processed.length + skipped.length === remaining.length;
  await brandRef.update({
    // 시간 예산 초과로 다 못 끝냈으면 PENDING으로 남겨 "백필 이어하기"가 계속 보이게 합니다.
    backfill_status: isDone ? "COMPLETED" : "PENDING",
    updated_at: Date.now(),
  });
  return { done: isDone, processedMonths: processed, skippedMonths: skipped };
}

