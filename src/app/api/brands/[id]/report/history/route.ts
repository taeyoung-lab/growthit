import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ApiAuthError } from "@/lib/adminAuthCheck";
import { requireBrandAccess } from "@/lib/brandAccess";
import type { ReportPublishHistory } from "@/lib/types";

// 화면⑤ 발행 이력 — 이 브랜드의 PPT 발행 기록(최신순 최대 30건).
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireBrandAccess(req, params.id);
    const db = getAdminDb();
    // 복합 인덱스 없이 쓰려고 brand_id 단일 조건으로 읽고 정렬은 메모리에서 합니다.
    const snap = await db.collection("reportPublishHistory").where("brand_id", "==", params.id).get();
    const items = snap.docs
      .map((d) => d.data() as ReportPublishHistory)
      .filter((h) => h.organization_id === profile.organization_id)
      .sort((a, b) => b.published_at - a.published_at)
      .slice(0, 30)
      .map((h) => ({ id: h.id, year_month: h.year_month, file_name: h.file_name ?? null, published_at: h.published_at }));
    return NextResponse.json({ items });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[GET /api/brands/${params.id}/report/history]`, e);
    return NextResponse.json({ error: "발행 이력을 불러오지 못했습니다." }, { status: 500 });
  }
}
