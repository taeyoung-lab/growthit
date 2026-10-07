import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApiAuthError } from "@/lib/adminAuthCheck";
import { requireBrandAccess } from "@/lib/brandAccess";
import { loadReportInput, ReportDataMissingError } from "@/lib/reportMetrics/loadReportInput";
import { sanitizeOverrides } from "@/lib/reportMetrics/overrides";

// 화면④ — 검수·수정용 리포트 입력 조회(GET)와 담당자 입력(수수료·목표·액션) 저장(PUT).
// 지표 계산은 클라이언트가 buildReportModel로 즉시 다시 하므로, 서버는 저장된 원본+입력만 내려줍니다.
export const maxDuration = 30;
export const runtime = "nodejs";

function isYm(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // 2026-10-06: 슈퍼 관리자 또는 이 브랜드의 담당자만 — brandAccess.ts 참고.
    const { brand } = await requireBrandAccess(req, params.id);
    const ym = req.nextUrl.searchParams.get("year_month");
    if (!isYm(ym)) return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    const input = await loadReportInput(getAdminDb(), brand, ym);
    return NextResponse.json({ input });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ReportDataMissingError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error(`[GET /api/brands/${params.id}/report]`, e);
    return NextResponse.json({ error: "리포트 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireBrandAccess(req, params.id);
    const body = await req.json().catch(() => ({}));
    if (!isYm(body.year_month)) return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    let overrides;
    try {
      overrides = sanitizeOverrides(body.overrides);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "입력값이 올바르지 않습니다." }, { status: 400 });
    }
    const ref = getAdminDb().collection("brandMonthlyData").doc(`${params.id}_${body.year_month}`);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "수집된 데이터가 없습니다. 먼저 데이터를 수집해주세요." }, { status: 404 });
    await ref.update({ overrides, updated_at: Date.now() });
    return NextResponse.json({ ok: true, overrides });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[PUT /api/brands/${params.id}/report]`, e);
    return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
  }
}
