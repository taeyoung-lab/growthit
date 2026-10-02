import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";
import type { BrandMonthlyData, ReportBrand } from "@/lib/types";

// Monthly Report 발행 화면①(브랜드/월 선택)에서 "이 브랜드·월이 이미 수집/발행된 적 있는지"를
// 보여주기 위한 조회 전용 엔드포인트입니다. brandMonthlyData는 클라이언트 Firestore 규칙이 아직
// 정비되지 않아(firestore.rules에 brands/brandCredentials/brandMonthlyData/reportPublishHistory
// 경로 자체가 없음 — 전부 서버 Admin SDK 경유로만 다뤄지고 있었음) 여기서도 그 패턴을 그대로 따라
// 서버에서만 읽습니다.
function isValidYearMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireUser(req);
    const yearMonth = req.nextUrl.searchParams.get("year_month");
    if (!isValidYearMonth(yearMonth)) {
      return NextResponse.json({ error: "year_month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
    }

    const db = getAdminDb();
    const brandSnap = await db.collection("brands").doc(params.id).get();
    if (!brandSnap.exists) {
      return NextResponse.json({ error: "대상 브랜드를 찾을 수 없습니다." }, { status: 404 });
    }
    const brand = brandSnap.data() as ReportBrand;
    if (brand.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: "이 브랜드에 접근할 권한이 없습니다." }, { status: 403 });
    }

    const docId = `${params.id}_${yearMonth}`;
    const snap = await db.collection("brandMonthlyData").doc(docId).get();
    if (!snap.exists) {
      return NextResponse.json({ exists: false, published: false, collected_at: null, source: null });
    }
    const data = snap.data() as BrandMonthlyData;
    return NextResponse.json({
      exists: true,
      published: data.published,
      collected_at: data.collected_at,
      source: data.source,
    });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(`[GET /api/brands/${params.id}/monthly-data]`, e);
    return NextResponse.json({ error: "조회에 실패했습니다." }, { status: 500 });
  }
}
