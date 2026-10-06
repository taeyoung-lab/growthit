import type { Firestore } from "firebase-admin/firestore";
import type { MemberOrderAgg } from "./collectExtras";

// 회원별 월간 구매 집계(고객번호 cusId → 주문수·결제액)를 brandMonthlyMembers 컬렉션에 저장합니다.
// 구매 빈도 세그먼트(최근 3개월 30/20/10회 이상), 구매 상위 고객 매출 기여도(파레토), 신규 구매자
// 재구매율을 계산할 때 읽습니다. 브랜드×월 하나가 수만 명이 될 수 있어 brandMonthlyData(문서 1MB 제한)와
// 분리하고, 한 문서에 최대 MEMBERS_PER_DOC명씩 나눠 담습니다. 이 컬렉션은 firestore.rules에 규칙이 없어
// 클라이언트 접근이 전면 차단되고, 서버(firebase-admin)에서만 읽고 씁니다. 이름·연락처는 저장하지
// 않습니다(고객번호·주문수·결제액만).
//
// 문서 ID: `${brandId}_${yearMonth}_${chunkIndex}`, 필드: brand_id, organization_id, year_month, chunk,
// chunk_count, truncated, flat([cusId, 주문수, 결제액, cusId, 주문수, 결제액, …] — Firestore는 배열 안의
// 배열을 못 써서 한 줄로 이어 붙임), updated_at.
const MEMBERS_PER_DOC = 12_000;

export function memberAggDocId(brandId: string, yearMonth: string, chunk: number): string {
  return `${brandId}_${yearMonth}_${chunk}`;
}

export async function saveMemberAggregates(
  db: Firestore,
  params: { brandId: string; organizationId: string; yearMonth: string; agg: MemberOrderAgg }
): Promise<void> {
  const { brandId, organizationId, yearMonth, agg } = params;
  const col = db.collection("brandMonthlyMembers");
  const members = agg.flat.length / 3;
  const chunkCount = Math.max(1, Math.ceil(members / MEMBERS_PER_DOC));

  // 재수집으로 청크 수가 줄었을 때 남는 옛 청크를 정리하기 위해 기존 chunk_count를 먼저 읽습니다.
  const prev = await col.doc(memberAggDocId(brandId, yearMonth, 0)).get();
  const prevCount = prev.exists ? Number((prev.data() as { chunk_count?: number }).chunk_count ?? 0) : 0;

  const batch = db.batch();
  for (let i = 0; i < chunkCount; i++) {
    const slice = agg.flat.slice(i * MEMBERS_PER_DOC * 3, (i + 1) * MEMBERS_PER_DOC * 3);
    batch.set(col.doc(memberAggDocId(brandId, yearMonth, i)), {
      brand_id: brandId,
      organization_id: organizationId,
      year_month: yearMonth,
      chunk: i,
      chunk_count: chunkCount,
      truncated: agg.truncated,
      flat: slice,
      updated_at: Date.now(),
    });
  }
  for (let i = chunkCount; i < prevCount; i++) batch.delete(col.doc(memberAggDocId(brandId, yearMonth, i)));
  await batch.commit();
}

// 한 달치 회원 집계를 읽어 Map(cusId → [주문수, 결제액])으로 돌려줍니다. 문서가 없으면 null.
export async function loadMemberAggregates(
  db: Firestore,
  brandId: string,
  yearMonth: string
): Promise<{ members: Map<number, [number, number]>; truncated: boolean } | null> {
  const col = db.collection("brandMonthlyMembers");
  const first = await col.doc(memberAggDocId(brandId, yearMonth, 0)).get();
  if (!first.exists) return null;
  const head = first.data() as { chunk_count?: number; truncated?: boolean; flat?: number[] };
  const chunkCount = Number(head.chunk_count ?? 1);
  const docs = [first];
  if (chunkCount > 1) {
    const rest = await Promise.all(
      Array.from({ length: chunkCount - 1 }, (_, i) => col.doc(memberAggDocId(brandId, yearMonth, i + 1)).get())
    );
    docs.push(...rest);
  }
  const members = new Map<number, [number, number]>();
  for (const d of docs) {
    const flat = ((d.data() as { flat?: number[] } | undefined)?.flat ?? []) as number[];
    for (let i = 0; i + 2 < flat.length; i += 3) members.set(flat[i], [flat[i + 1], flat[i + 2]]);
  }
  return { members, truncated: !!head.truncated };
}

// Firestore 문서는 1MB 제한입니다. 매장 수가 아주 많은 브랜드에서 추가 통계(extras)까지 합친 본 데이터가 이를
// 넘으면 set()이 실패해 수집 전체가 날아가므로, 넘기 전에 덜 중요한 순서(매장별 쿠폰·메뉴·매장별 매출)로
// extras 일부를 비웁니다. 비운 항목은 extras.dropped에 이름을 남깁니다.
const MAX_DOC_BYTES = 900_000;

export function fitMonthlyDataSize(data: Record<string, unknown>): Record<string, unknown> {
  const size = () => Buffer.byteLength(JSON.stringify(data), "utf8");
  const extras = data.extras as Record<string, unknown> | null | undefined;
  if (!extras || size() <= MAX_DOC_BYTES) return data;
  const dropped: string[] = [];
  // 2026-10-06: 매장 595개짜리 우지커피에서 salesStore를 통째로 비웠더니 [0]("전체" 합계 행)까지 사라져
  // 전체 매출·앱결제액·앱 비중이 모두 비었습니다. 매출 지표는 [0]만 있으면 계산되므로, 이 두 항목은
  // 먼저 "전체" 행 하나만 남기고 줄여 보고, 그래도 크면 그때 비웁니다(리포트 매장별 표만 빠짐).
  for (const key of ["couponsByStore", "salesItem", "salesStore"]) {
    if (size() <= MAX_DOC_BYTES) break;
    const v = extras[key];
    if (v == null) continue;
    if ((key === "salesItem" || key === "salesStore") && Array.isArray(v) && v.length > 1) {
      extras[key] = v.slice(0, 1);
      dropped.push(`${key}(전체 행만 유지)`);
      continue;
    }
    extras[key] = null;
    dropped.push(key);
  }
  if (dropped.length > 0) {
    extras.dropped = dropped;
    console.warn(`[fitMonthlyDataSize] 문서 크기 초과로 extras 일부 제외: ${dropped.join(", ")}`);
  }
  return data;
}
