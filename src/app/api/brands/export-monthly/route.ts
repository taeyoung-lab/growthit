import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";
import { canAccessBrand } from "@/lib/brandAccess";
import {
  breakdownCounts,
  buildExportRow,
  rowsToCsv,
  type BreakdownCounts,
  type ExportRow,
} from "@/lib/reportMetrics/monthlyExport";
import type { ReportBrand } from "@/lib/types";

// 월별 실적 CSV 내보내기 — 매출 프로젝션(예측) 학습·검증용 데이터를 브랜드×월 한 줄씩 내려받습니다.
// 권한은 다른 브랜드 API와 같습니다: 슈퍼 관리자는 같은 조직의 모든 브랜드, 담당자는 본인 담당 브랜드만.
// 읽기 전용이라 DB를 바꾸지 않으며, 문서 용량이 큰 brandMonthlyData는 필요한 필드만 골라 읽습니다.
// 선택 쿼리: ?brand_id=<id> (한 브랜드만), ?include_inactive=1 (비활성 브랜드 포함)
export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { uid, profile } = await requireUser(req);
    const db = getAdminDb();
    const onlyBrand = req.nextUrl.searchParams.get("brand_id");
    const includeInactive = req.nextUrl.searchParams.get("include_inactive") === "1";

    const brandSnap = await db.collection("brands").where("organization_id", "==", profile.organization_id).get();
    const brands = brandSnap.docs
      .map((d) => ({ ...(d.data() as ReportBrand), id: d.id }))
      .filter((b) => canAccessBrand(profile, uid, b))
      .filter((b) => includeInactive || b.brand_status !== "INACTIVE")
      .filter((b) => !onlyBrand || b.id === onlyBrand);

    const rows: ExportRow[] = [];
    for (const b of brands) {
      const info = { id: b.id, brand_name: b.brand_name, service_open_date: b.service_open_date ?? null };

      // 월별 매장 전체 목록(있는 달만) — 매장 수 시계열 보강용.
      const bdByMonth = new Map<string, BreakdownCounts>();
      const bdSnap = await db
        .collection("brandMonthlyBreakdown")
        .where("brand_id", "==", b.id)
        .select("year_month", "stores")
        .get();
      for (const d of bdSnap.docs) {
        const x = d.data() as { year_month?: string; stores?: unknown };
        const c = breakdownCounts(x.stores);
        if (x.year_month && c) bdByMonth.set(x.year_month, c);
      }

      const snap = await db
        .collection("brandMonthlyData")
        .where("brand_id", "==", b.id)
        .select(
          "year_month",
          "source",
          "collected_at",
          "data.extras.salesStore",
          "data.extras.salesStoreMeta",
          "data.dashboard",
          "data.settlementsSales.totalInfo",
          "data.settlementSource",
          "data.storeManage"
        )
        .get();
      const docs = snap.docs
        .map((d) => d.data() as { year_month?: string; source?: unknown; collected_at?: unknown; data?: unknown })
        .filter((d) => typeof d.year_month === "string")
        .sort((a, z) => String(a.year_month).localeCompare(String(z.year_month)));
      for (const d of docs) {
        rows.push(buildExportRow(info, d.year_month as string, d, bdByMonth.get(d.year_month as string) ?? null));
      }
    }

    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const fileName = `growthit_monthly_${today}.csv`;
    return new NextResponse(rowsToCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "X-File-Name": encodeURIComponent(fileName),
        "Access-Control-Expose-Headers": "X-File-Name",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[GET /api/brands/export-monthly]", e);
    return NextResponse.json({ error: "월별 실적 내보내기에 실패했습니다." }, { status: 500 });
  }
}

