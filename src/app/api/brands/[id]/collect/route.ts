import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApiAuthError } from "@/lib/adminAuthCheck";
import { requireBrandAccess } from "@/lib/brandAccess";
import { decryptCmsPassword } from "@/lib/cmsCredentials";
import { loginToCms } from "@/lib/cmsAutomation/login";
import { collectMonthlyData } from "@/lib/cmsAutomation/collect";
import { CmsAutomationError } from "@/lib/cmsAutomation/types";
import { saveMemberAggregates, fitMonthlyDataSize } from "@/lib/cmsAutomation/memberAggStore";
import type { BrandCredentials, BrandMonthlyData } from "@/lib/types";

// 그로스잇 브랜드 CMS 자동 수집 트리거 — 저장된 계정으로 헤드리스 브라우저 로그인 후(login.ts),
// 로그인으로 얻은 쿠키로 JSON API를 호출해(collect.ts) brandMonthlyData에 raw 데이터를 씁니다.
//
// Monthly Report 발행 메뉴는 조직 내 누구나 접근 가능(담당자 전용 아님 — 2026-10-01 결정: "계정이
// 있으면 어디든 사용 가능")이므로, 여기서도 생성자(created_by) 제한 없이 같은 조직 소속이면 누구나
// 호출할 수 있게 합니다(브랜드 수정 권한은 담당자/슈퍼관리자로 제한되지만, 수집 실행은 다릅니다).
//
// 백필(서비스 오픈일~전월) 배치 로직은 아직 이 엔드포인트를 쓰지 않습니다 — 지금은 화면③(월간 발행
// 플로우에서의 수동 1개월 수집) 전용이며, 백필 전용 실행 로직은 별도 구현 예정입니다.
//
// Puppeteer 로그인이 느릴 수 있어 기본 서버리스 함수 제한 시간을 늘립니다.
//
// 2026-10-02: 60→120초로 상향. 브래덴코·2026-09 수동 수집이 이 라우트에서만 매번 504로 실패 —
// 같은 날 영커피(빠른 CMS)는 정상 성공해서 코드 문제가 아니라 시간 문제로 판단. 브래덴코 CMS 정산
// 조회가 달에 따라 45~56초(collect.ts CMS_FETCH_TIMEOUT_MS 연혁 주석 참고)이고 여기에 로그인(3~6초)과
// 나머지 호출이 더해지면 60초를 넘기는데, 백필 라우트(backfill/route.ts)는 이미 120초로 올려둔 반면
// 이 라우트만 60초로 남아 있었습니다(Hobby 플랜도 Fluid Compute 기준 최대 300초 지원 — 백필 라우트
// 주석 참고). 백필 라우트·collect.ts의 CMS_FETCH_TIMEOUT_MS(110초)와 같은 기준으로 맞춥니다.
export const maxDuration = 120;
export const runtime = "nodejs";

interface CollectRequestBody {
  year_month: string; // YYYY-MM
}

function isValidYearMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // 2026-10-06: 슈퍼 관리자 또는 이 브랜드의 담당자만(복수 담당자) — brandAccess.ts 참고.
    const { uid, brand } = await requireBrandAccess(req, params.id);
    const body = (await req.json().catch(() => ({}))) as Partial<CollectRequestBody>;
    if (!isValidYearMonth(body.year_month)) {
      return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    }
    const yearMonth = body.year_month;

    const db = getAdminDb();
    const brandRef = db.collection("brands").doc(params.id);
    const credsSnap = await db.collection("brandCredentials").doc(params.id).get();
    if (!credsSnap.exists) {
      return NextResponse.json(
        { error: "저장된 CMS 계정 정보가 없습니다. 브랜드 설정에서 CMS 계정을 먼저 등록해주세요." },
        { status: 400 }
      );
    }
    const creds = credsSnap.data() as BrandCredentials;

    if (brand.phone_verification_required && !creds.fixed_verification_code_encrypted) {
      return NextResponse.json(
        { error: "이 브랜드는 전화번호 인증이 필요한데 고정 인증번호가 저장돼 있지 않습니다. 브랜드 설정에서 입력해주세요." },
        { status: 400 }
      );
    }

    let collected;
    try {
      const session = await loginToCms({
        cmsUrl: brand.cms_url,
        username: creds.cms_username,
        password: decryptCmsPassword(creds.cms_password_encrypted),
        phoneVerificationRequired: brand.phone_verification_required,
        fixedVerificationCode: creds.fixed_verification_code_encrypted
          ? decryptCmsPassword(creds.fixed_verification_code_encrypted)
          : null,
      });
      collected = await collectMonthlyData(brand.cms_url, session, yearMonth);
    } catch (e) {
      if (e instanceof CmsAutomationError) {
        console.error(`[POST /api/brands/${params.id}/collect] ${e.step}`, e);
        // CMS가 정산 조회를 504로 끊은 경우(collect.ts의 엑셀 대체 경로도 못 쓴 경우) — 담당자가 바로
        // 무엇을 해야 하는지 알 수 있게 대상 월과 CMS의 어느 메뉴를 보면 되는지 함께 안내합니다.
        const hint =
          e.step === "GATEWAY_TIMEOUT"
            ? ` [안내] ${yearMonth} 정산 데이터를 자동으로 가져오지 못했습니다. 해당 브랜드 CMS의 "정산 > 매출 정산"에서 월조회(${yearMonth})로 검색한 뒤 "엑셀받기"로 받은 파일이 필요합니다(수기 업로드 기능은 준비 중입니다).`
            : "";
        return NextResponse.json({ error: e.message + hint, step: e.step }, { status: 502 });
      }
      throw e;
    }

    const now = Date.now();
    const docId = `${params.id}_${yearMonth}`;
    const existing = await db.collection("brandMonthlyData").doc(docId).get();

    const data: BrandMonthlyData = {
      id: docId,
      organization_id: brand.organization_id,
      brand_id: params.id,
      year_month: yearMonth,
      source: "MANUAL",
      data: fitMonthlyDataSize({
        dashboard: collected.dashboard,
        settlementsSales: collected.settlementsSales,
        settlementSource: collected.settlementSource,
        targetGroupStats: collected.targetGroupStats,
        storeManage: collected.storeManage,
        memberStats: collected.memberStats,
        extras: collected.extras,
      }),
      // 기존에 담당자가 화면④에서 직접 고친 값(overrides)이 있다면 재수집 시에도 보존합니다 —
      // 원본(data)만 최신 수집값으로 갈아끼우고, 사람이 직접 고친 값은 자동 덮어쓰기 대상이 아닙니다.
      overrides: (existing.exists && (existing.data() as BrandMonthlyData).overrides) || {},
      published: (existing.exists && (existing.data() as BrandMonthlyData).published) || false,
      collected_at: collected.collectedAt,
      collected_by: uid,
      updated_at: now,
    };
    await db.collection("brandMonthlyData").doc(docId).set(data);
    // 회원별 월간 구매 집계는 용량 때문에 별도 컬렉션에 저장합니다. 실패해도 위 본 데이터는 이미 저장됐으므로
    // 수집 전체를 실패로 돌리지 않고 경고만 남깁니다(회원 지표만 비게 됨).
    if (collected.memberOrderAgg) {
      try {
        await saveMemberAggregates(db, {
          brandId: params.id,
          organizationId: brand.organization_id,
          yearMonth,
          agg: collected.memberOrderAgg,
        });
      } catch (e) {
        console.warn(`[POST /api/brands/${params.id}/collect] 회원 집계 저장 실패`, e);
      }
    }

    return NextResponse.json({ ok: true, year_month: yearMonth, data });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[POST /api/brands/${params.id}/collect]`, e);
    // 로그인한 담당자에게만 보이는 화면이므로, 원인 파악을 위해 짧게 잘라서 함께 내려줍니다.
    const detail = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 240) : "";
    return NextResponse.json({ error: "데이터 수집에 실패했습니다." + (detail ? ` (원인: ${detail})` : "") }, { status: 500 });
  }
}

