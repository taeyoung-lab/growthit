import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError } from "@/lib/adminAuthCheck";
import { requireBrandAccess } from "@/lib/brandAccess";
import { retrySkippedMonth } from "@/lib/cmsAutomation/backfill";

// 백필에서 CMS 504로 건너뛴 달(backfill_skipped_months)을 한 번에 한 달씩 다시 수집합니다.
// 정산 엑셀 대체 경로(collect.ts)가 생기기 전에 건너뛴 달을 채우기 위한 용도입니다.
// 한 달이 CMS 쪽에서 약 64초 걸릴 수 있어 백필 라우트와 같은 120초로 맞춥니다.
export const maxDuration = 120;
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { uid, brand } = await requireBrandAccess(req, params.id);
    const body = (await req.json().catch(() => ({}))) as { year_month?: string };
    if (body.year_month !== undefined && !/^\d{4}-\d{2}$/.test(body.year_month)) {
      return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    }

    if (!brand.has_saved_credentials) {
      return NextResponse.json(
        { error: "저장된 CMS 계정 정보가 없습니다. 브랜드 설정에서 CMS 계정을 먼저 등록해주세요." },
        { status: 400 }
      );
    }

    const result = await retrySkippedMonth(params.id, uid, body.year_month);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[POST /api/brands/${params.id}/backfill/retry-skipped]`, e);
    return NextResponse.json({ error: "건너뛴 달 재수집에 실패했습니다." }, { status: 500 });
  }
}
