import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApiAuthError } from "@/lib/adminAuthCheck";
import { requireBrandAccess } from "@/lib/brandAccess";
import { buildReportModel } from "@/lib/reportMetrics/buildReportModel";
import { loadReportInput, ReportDataMissingError } from "@/lib/reportMetrics/loadReportInput";
import { sanitizeOverrides } from "@/lib/reportMetrics/overrides";
import { buildReportPptx } from "@/lib/reportPpt/buildPptx";
import { buildReportHtml } from "@/lib/reportWeb/buildReportHtml";

// 화면⑤ — "리포트 발행": 담당자 입력을 저장하고, 저장된 데이터로 PPT를 만들어 바로 내려줍니다.
// PPT 파일은 저장소에 올리지 않습니다(2026-10-01 "다운로드만 제공" 결정). 발행 이력만 남깁니다.
export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { uid, brand } = await requireBrandAccess(req, params.id);
    const body = await req.json().catch(() => ({}));
    const ym = body.year_month;
    if (typeof ym !== "string" || !/^\d{4}-\d{2}$/.test(ym)) {
      return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    }
    const db = getAdminDb();

    const dataRef = db.collection("brandMonthlyData").doc(`${params.id}_${ym}`);
    if (body.overrides !== undefined) {
      let overrides;
      try {
        overrides = sanitizeOverrides(body.overrides);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "입력값이 올바르지 않습니다." }, { status: 400 });
      }
      const exists = (await dataRef.get()).exists;
      if (!exists) return NextResponse.json({ error: "수집된 데이터가 없습니다. 먼저 데이터를 수집해주세요." }, { status: 404 });
      await dataRef.update({ overrides, updated_at: Date.now() });
    }

    const input = await loadReportInput(db, brand, ym);
    const model = buildReportModel(input);
    // body.format: "pptx"(기본) | "html"(웹 리포트 — 팀 월간 리포트 포맷). 같은 데이터로 두 형태를 발행합니다.
    const isHtml = body.format === "html";
    const file = isHtml ? Buffer.from(buildReportHtml(input, model), "utf8") : await buildReportPptx(model);

    const fileName = isHtml ? `${brand.brand_name}_${ym.replace("-", "")}_월간리포트.html` : `${brand.brand_name}_${ym.replace("-", "")}_성과리포트.pptx`;
    const now = Date.now();
    const histRef = db.collection("reportPublishHistory").doc();
    await histRef.set({
      id: histRef.id,
      organization_id: brand.organization_id,
      brand_id: brand.id,
      year_month: ym,
      ppt_storage_path: null,
      file_name: fileName,
      published_by: uid,
      published_at: now,
    });
    await dataRef.update({ published: true, updated_at: now });
    // last_published_month는 더 최근 달만 갱신합니다(과거 월 재발행이 최신 표시를 되돌리지 않도록).
    if (!brand.last_published_month || brand.last_published_month < ym) {
      await db.collection("brands").doc(brand.id).update({ last_published_month: ym, updated_at: now });
    }

    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": isHtml ? "text/html; charset=utf-8" : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-File-Name": encodeURIComponent(fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ReportDataMissingError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error(`[POST /api/brands/${params.id}/report/publish]`, e);
    return NextResponse.json({ error: "리포트 발행에 실패했습니다." }, { status: 500 });
  }
}
