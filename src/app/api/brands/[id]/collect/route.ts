import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";
import { decryptCmsPassword } from "@/lib/cmsCredentials";
import { loginToCms } from "@/lib/cmsAutomation/login";
import { collectMonthlyData } from "@/lib/cmsAutomation/collect";
import { CmsAutomationError } from "@/lib/cmsAutomation/types";
import type { BrandCredentials, BrandMonthlyData, ReportBrand } from "@/lib/types";

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
export const maxDuration = 60;
export const runtime = "nodejs";

interface CollectRequestBody {
  year_month: string; // YYYY-MM
}

function isValidYearMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { uid, profile } = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Partial<CollectRequestBody>;
    if (!isValidYearMonth(body.year_month)) {
      return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    }
    const yearMonth = body.year_month;

    const db = getAdminDb();
    const brandRef = db.collection("brands").doc(params.id);
    const [brandSnap, credsSnap] = await Promise.all([
      brandRef.get(),
      db.collection("brandCredentials").doc(params.id).get(),
    ]);

    if (!brandSnap.exists) {
      return NextResponse.json({ error: "대상 브랜드를 찾을 수 없습니다." }, { status: 404 });
    }
    const brand = brandSnap.data() as ReportBrand;
    if (brand.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: "이 브랜드에 접근할 권한이 없습니다." }, { status: 403 });
    }
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
        return NextResponse.json({ error: e.message, step: e.step }, { status: 502 });
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
      data: {
        dashboard: collected.dashboard,
        settlementsSales: collected.settlementsSales,
        targetGroupStats: collected.targetGroupStats,
        storeManage: collected.storeManage,
        memberStats: collected.memberStats,
      },
      // 기존에 담당자가 화면④에서 직접 고친 값(overrides)이 있다면 재수집 시에도 보존합니다 —
      // 원본(data)만 최신 수집값으로 갈아끼우고, 사람이 직접 고친 값은 자동 덮어쓰기 대상이 아닙니다.
      overrides: (existing.exists && (existing.data() as BrandMonthlyData).overrides) || {},
      published: (existing.exists && (existing.data() as BrandMonthlyData).published) || false,
      collected_at: collected.collectedAt,
      collected_by: uid,
      updated_at: now,
    };
    await db.collection("brandMonthlyData").doc(docId).set(data);

    return NextResponse.json({ ok: true, year_month: yearMonth, data });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[POST /api/brands/${params.id}/collect]`, e);
    return NextResponse.json({ error: "데이터 수집에 실패했습니다." }, { status: 500 });
  }
}

