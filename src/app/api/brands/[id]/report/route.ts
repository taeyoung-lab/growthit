
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";
import { loadReportInput, ReportDataMissingError } from "@/lib/reportMetrics/loadReportInput";
import { sanitizeOverrides } from "@/lib/reportMetrics/overrides";
import type { ReportBrand } from "@/lib/types";

// 화면④ — 검수·수정용 리포트 입력 조회(GET)와 담당자 입력(수수료·목표·액션) 저장(PUT).
// 지표 계산은 클라이언트가 buildReportModel로 즉시 다시 하므로, 서버는 저장된 원본+입력만 내려줍니다.
export const maxDuration = 30;
export const runtime = "nodejs";

function isYm(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
}

async function loadBrand(id: string, orgId: string) {
  const snap = await getAdminDb().collection("brands").doc(id).get();
  if (!snap.exists) return { error: NextResponse.json({ error: "대상 브랜드를 찾을 수 없습니다." }, { status: 404 }) };
  const brand = { ...(snap.data() as ReportBrand), id: snap.id };
  if (brand.organization_id !== orgId) return { error: NextResponse.json({ error: "이 브랜드에 접근할 권한이 없습니다." }, { status: 403 }) };
  return { brand };
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireUser(req);
    const ym = req.nextUrl.searchParams.get("year_month");
    if (!isYm(ym)) return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    const r = await loadBrand(params.id, profile.organization_id);
    if (r.error) return r.error;
    const input = await loadReportInput(getAdminDb(), r.brand, ym);
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
    const { profile } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    if (!isYm(body.year_month)) return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    const r = await loadBrand(params.id, profile.organization_id);
    if (r.error) return r.error;
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
