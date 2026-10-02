import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";
import { runBackfillBatch } from "@/lib/cmsAutomation/backfill";
import { CmsAutomationError } from "@/lib/cmsAutomation/types";
import type { ReportBrand } from "@/lib/types";

// 그로스잇 브랜드 백필(서비스 오픈일~전월 과거 데이터 일괄 수집) 트리거 — 2026-10-01 확정 사항
// (화면 설계 질문지 7번) 그대로: 화면④ 리뷰 없이 CMS 원본값을 brandMonthlyData에 바로 저장하고,
// PPT는 생성하지 않습니다(MoM 비교용 기준 데이터로만 사용). 브랜드 생성 시 서비스 오픈일과 CMS
// 계정이 함께 입력되면 /brands 화면에서 자동으로 1회 호출됩니다(src/app/brands/page.tsx 참고).
//
// 서버리스 함수 시간 제한(아래 maxDuration) 안에 전체 기간을 다 못 끝내면 backfill_status가
// PENDING으로 남습니다 — 브랜드 관리 화면의 "백필 이어하기" 버튼으로 이 엔드포인트를 몇 번이고
// 다시 호출할 수 있고, 이미 완료된 달은 건너뛰므로(backfill_completed_through 기준) 중복
// 수집되지 않습니다.
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireUser(req);

    const db = getAdminDb();
    const brandSnap = await db.collection("brands").doc(params.id).get();
    if (!brandSnap.exists) {
      return NextResponse.json({ error: "대상 브랜드를 찾을 수 없습니다." }, { status: 404 });
    }
    const brand = brandSnap.data() as ReportBrand;
    if (brand.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: "이 브랜드에 접근할 권한이 없습니다." }, { status: 403 });
    }
    if (!brand.service_open_date) {
      return NextResponse.json(
        { error: "서비스 오픈일이 등록된 브랜드만 백필할 수 있습니다." },
        { status: 400 }
      );
    }
    if (!brand.has_saved_credentials) {
      return NextResponse.json(
        { error: "저장된 CMS 계정 정보가 없습니다. 브랜드 설정에서 CMS 계정을 먼저 등록해주세요." },
        { status: 400 }
      );
    }

    const result = await runBackfillBatch(params.id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof CmsAutomationError) {
      console.error(`[POST /api/brands/${params.id}/backfill] ${e.step}`, e);
      return NextResponse.json({ error: e.message, step: e.step }, { status: 502 });
    }
    console.error(`[POST /api/brands/${params.id}/backfill]`, e);
    return NextResponse.json({ error: "백필 실행에 실패했습니다." }, { status: 500 });
  }
}

