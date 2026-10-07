
import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApiAuthError } from "@/lib/adminAuthCheck";
import { requireBrandAccess } from "@/lib/brandAccess";
import { collectBreakdownOnly } from "@/lib/cmsAutomation/collectBreakdownOnly";
import type { BrandCredentials } from "@/lib/types";

// 정산 없이 월별 매장·메뉴 목록만 (재)수집 — 정산 조회가 CMS에서 504로 끊기는 브랜드·월용. 한 번에 한 달.
export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { brand } = await requireBrandAccess(req, params.id);
    const body = (await req.json().catch(() => ({}))) as { year_month?: string };
    if (typeof body.year_month !== "string" || !/^\d{4}-\d{2}$/.test(body.year_month)) {
      return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    }
    const credsSnap = await getAdminDb().collection("brandCredentials").doc(params.id).get();
    if (!credsSnap.exists) return NextResponse.json({ error: "저장된 CMS 계정 정보가 없습니다." }, { status: 400 });
    const creds = credsSnap.data() as BrandCredentials;
    const summary = await collectBreakdownOnly({ brandId: params.id, brand, creds, yearMonth: body.year_month });
    return NextResponse.json({ ok: true, year_month: body.year_month, ...summary });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[POST /api/brands/${params.id}/collect-breakdown]`, e);
    const detail = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 240) : "";
    return NextResponse.json({ error: "매장·메뉴 목록 수집에 실패했습니다." + (detail ? ` (원인: ${detail})` : "") }, { status: 500 });
  }
}
