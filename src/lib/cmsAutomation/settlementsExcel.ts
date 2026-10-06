
// CMS 매출 정산 "엑셀받기" 표를 /api/settlements/sales(JSON)와 같은 필드명으로 바꿉니다.
// JSON API가 CMS 게이트웨이 타임아웃(504)으로 실패하는 달의 대체 경로용입니다(collect.ts 참고).
//
// 2026-10-05 라이브 확인(브래덴코·영커피, 표준형): 엑셀 헤더는 아래 11개 컬럼이고, 첫 데이터 행이
// "전체" 합계, 그 아래가 매장별 행입니다. 영커피·2026-09로 JSON과 대조한 결과 매장 101개 중 99개는
// 전 컬럼이 일치했고, 2개 매장(마이너스 조정이 있는 폐업점 등)만 값이 달랐습니다 — 엑셀은 마이너스를
// 0으로 보여주는 것으로 보이며, 엑셀의 "전체" 합계는 CMS 대시보드 값과 일치했습니다.
//
// JSON에는 있지만 엑셀에는 없는 필드(storeId, pickupFee·storeFee·deliveryFee·reserveFee·
// dailyPassFee·newOrderTypeFee 등 서비스이용료 세부 내역)는 만들지 않습니다 — 없는 값을 0 같은
// 임의 값으로 채우면 실측값처럼 보이기 때문입니다.

export interface SettlementStoreRow {
  storeNm: string;
  orderCount: number;
  itemPayAmount: number;
  companyPayDiscountAmount: number;
  storePayDiscountAmount: number;
  deliveryAmount: number;
  companyDeliveryDiscountAmount: number;
  storeDeliveryDiscountAmount: number;
  pgFee: number;
  serviceFee: number;
  totalFee: number;
}

export interface SettlementsFromExcel {
  totalInfo: SettlementStoreRow;
  totalCnt: number;
  list: SettlementStoreRow[];
}

// 헤더 → 필드. 공백을 제거한 문자열로 비교하며, match가 "exact"면 완전 일치, "prefix"면 접두 일치입니다
// ("배달비"가 "본사 부담 배달 할인금" 등과 섞이지 않게 exact로 구분).
const COLUMNS: { field: keyof SettlementStoreRow; header: string; match: "exact" | "prefix" }[] = [
  { field: "storeNm", header: "매장명", match: "exact" },
  { field: "orderCount", header: "주문건수", match: "exact" },
  { field: "itemPayAmount", header: "결제금액", match: "prefix" },
  { field: "companyPayDiscountAmount", header: "본사부담할인금", match: "exact" },
  { field: "storePayDiscountAmount", header: "매장부담할인금", match: "exact" },
  { field: "deliveryAmount", header: "배달비", match: "exact" },
  { field: "companyDeliveryDiscountAmount", header: "본사부담배달할인금", match: "exact" },
  { field: "storeDeliveryDiscountAmount", header: "매장부담배달할인금", match: "exact" },
  { field: "pgFee", header: "PG수수료", match: "prefix" },
  { field: "serviceFee", header: "서비스이용료", match: "prefix" },
  { field: "totalFee", header: "예상정산금", match: "exact" },
];

function normalize(s: string): string {
  return s.replace(/\s+/g, "");
}

export function settlementsRowsToJson(rows: string[][]): SettlementsFromExcel {
  if (rows.length < 2) throw new Error("정산 엑셀에 데이터 행이 없습니다.");

  const header = rows[0].map(normalize);
  const colOf = {} as Record<keyof SettlementStoreRow, number>;
  for (const c of COLUMNS) {
    const idx = header.findIndex((h) => (c.match === "exact" ? h === c.header : h.startsWith(c.header)));
    if (idx < 0) {
      // 컬럼 구성이 바뀌었는데 위치만 믿고 읽으면 엉뚱한 값이 실측값처럼 저장됩니다 — 바로 실패시킵니다.
      throw new Error(`정산 엑셀 헤더에서 "${c.header}" 컬럼을 찾지 못했습니다(CMS 엑셀 양식이 바뀌었는지 확인 필요).`);
    }
    colOf[c.field] = idx;
  }

  const toRow = (r: string[]): SettlementStoreRow => {
    const num = (field: keyof SettlementStoreRow): number => {
      const raw = (r[colOf[field]] ?? "").replace(/,/g, "").trim();
      const n = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(n)) throw new Error(`정산 엑셀 숫자 변환 실패(${r[colOf.storeNm]} · ${field}: "${raw}")`);
      return n;
    };
    return {
      storeNm: r[colOf.storeNm] ?? "",
      orderCount: num("orderCount"),
      itemPayAmount: num("itemPayAmount"),
      companyPayDiscountAmount: num("companyPayDiscountAmount"),
      storePayDiscountAmount: num("storePayDiscountAmount"),
      deliveryAmount: num("deliveryAmount"),
      companyDeliveryDiscountAmount: num("companyDeliveryDiscountAmount"),
      storeDeliveryDiscountAmount: num("storeDeliveryDiscountAmount"),
      pgFee: num("pgFee"),
      serviceFee: num("serviceFee"),
      totalFee: num("totalFee"),
    };
  };

  const body = rows.slice(1).filter((r) => (r[colOf.storeNm] ?? "").trim() !== "");
  const totalRow = body.find((r) => r[colOf.storeNm].trim() === "전체");
  if (!totalRow) throw new Error('정산 엑셀에서 "전체" 합계 행을 찾지 못했습니다.');

  const list = body.filter((r) => r !== totalRow).map(toRow);
  return { totalInfo: toRow(totalRow), totalCnt: list.length, list };
}
