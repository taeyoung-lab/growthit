import { NextRequest, NextResponse } from "next/server";
import { ApiAuthError } from "@/lib/adminAuthCheck";
import { requireBrandAccess } from "@/lib/brandAccess";
import { runBackfillBatch } from "@/lib/cmsAutomation/backfill";
import { CmsAutomationError } from "@/lib/cmsAutomation/types";

// 그로스잇 브랜드 백필(서비스 오픈일~전월 과거 데이터 일괄 수집) 트리거 — 2026-10-01 확정 사항
// (화면 설계 질문지 7번) 그대로: 화면④ 리뷰 없이 CMS 원본값을 brandMonthlyData에 바로 저장하고,
// PPT는 생성하지 않습니다(MoM 비교용 기준 데이터로만 사용). 브랜드 생성 시 서비스 오픈일과 CMS
// 계정이 함께 입력되면 /brands 화면에서 자동으로 1회 호출됩니다(src/app/brands/page.tsx 참고).
//
// 서버리스 함수 시간 제한(아래 maxDuration) 안에 전체 기간을 다 못 끝내면 backfill_status가
// PENDING으로 남습니다 — 브랜드 관리 화면의 "백필 이어하기" 버튼으로 이 엔드포인트를 몇 번이고
// 다시 호출할 수 있고, 이미 완료된 달은 건너뛰므로(backfill_completed_through 기준) 중복
// 수집되지 않습니다.
//
// 2026-10-02: 60초를 "Vercel 플랫폼 자체 한도"로 잘못 가정하고 그 안에서 CMS_FETCH_TIMEOUT_MS를
// 1~수 초 단위로 쥐어짜 왔었음(collect.ts·backfill.ts 상단 주석의 반복된 상향/롤백 이력 참고).
// 실제로는 Vercel 공식 문서(Functions > Configuring Functions > Duration) 확인 결과 Hobby
// 플랜도 Fluid Compute 기준 maxDuration을 기본/최대 300초(5분)까지 지원 — 60초는 이 프로젝트가
// 초반에 넣어둔 자체 값일 뿐 플랫폼 제약이 아니었음. 브래덴코 2026-04 정산 조회가 54초 타임아웃도
// 일관되게 초과(직접 재현 측정 56.1초, HTTP 200 정상 응답 — 단지 느릴 뿐)하는 것을 계기로 120초로
// 상향(담당자 확인 완료) — 지금까지 관측된 월별 CMS 응답시간(45~56초)대비 넉넉한 여유를 둠.
export const maxDuration = 120;
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // 2026-10-06: 슈퍼 관리자 또는 이 브랜드의 담당자만(복수 담당자) — brandAccess.ts 참고.
    const { brand } = await requireBrandAccess(req, params.id);
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

