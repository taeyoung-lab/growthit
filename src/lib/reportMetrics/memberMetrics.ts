// 회원별 월간 구매 집계(고객번호 → [주문수, 결제액])로 구매빈도·파레토·재구매(리텐션)를 계산합니다.
// 개인 식별 정보는 쓰지 않고 고객번호 집합 연산만 합니다.

import type { MemberMetrics } from "./types";
import { round1 } from "./util";

export type MemberMap = Map<number, [number, number]>;
export interface MonthMembers {
  yearMonth: string;
  map: MemberMap;
  truncated: boolean;
}

const BANDS = [10, 20, 30];

// months: 오름차순(예: [m-2, m-1, 당월]) — 마지막이 당월. 당월 집계가 없으면 null을 돌려줍니다.
export function computeMemberMetrics(months: MonthMembers[]): MemberMetrics | null {
  if (months.length === 0) return null;
  const cur = months[months.length - 1];
  const prev = months.length >= 2 ? months[months.length - 2] : null;
  const prev2 = months.length >= 3 ? months[months.length - 3] : null;

  let orders = 0;
  let amount = 0;
  cur.map.forEach(([c, a]) => {
    orders += c;
    amount += a;
  });
  const buyers = cur.map.size;

  // 구매빈도 — 가진 달 전체(최대 3개월) 합산 주문 수 기준
  const combined = new Map<number, [number, number]>();
  for (const m of months) {
    m.map.forEach(([c, a], id) => {
      const x = combined.get(id) ?? [0, 0];
      x[0] += c;
      x[1] += a;
      combined.set(id, x);
    });
  }
  let totalAmt = 0;
  combined.forEach(([, a]) => (totalAmt += a));
  const frequency = BANDS.map((t) => {
    let members = 0;
    let amt = 0;
    combined.forEach(([c, a]) => {
      if (c >= t) {
        members += 1;
        amt += a;
      }
    });
    return { threshold: t, members, amountShare: totalAmt > 0 ? round1((amt / totalAmt) * 100) : 0 };
  });

  // 파레토 — 당월 결제액 기준 상위 10%·20% 회원의 결제 비중
  let pareto: MemberMetrics["pareto"] = null;
  if (buyers > 0 && amount > 0) {
    const sorted = Array.from(cur.map.values()).map(([, a]) => a).sort((a, b) => b - a);
    const share = (ratio: number) => {
      const n = Math.max(1, Math.ceil(sorted.length * ratio));
      let s = 0;
      for (let i = 0; i < n; i++) s += sorted[i];
      return round1((s / amount) * 100);
    };
    pareto = { top10Share: share(0.1), top20Share: share(0.2) };
  }

  // 재구매 — 전월 구매자 중 당월에도 구매한 비율
  let retention: MemberMetrics["retention"] = null;
  if (prev && prev.map.size > 0) {
    let repurchased = 0;
    prev.map.forEach((_, id) => {
      if (cur.map.has(id)) repurchased += 1;
    });
    retention = { prevBuyers: prev.map.size, repurchased, rate: round1((repurchased / prev.map.size) * 100) };
  }

  // 신규 구매자 — 당월 구매자 중 직전 집계 월(들)에 없던 회원. 직전 월이 하나도 없으면 알 수 없음.
  let newBuyers: number | null = null;
  if (prev) {
    let n = 0;
    cur.map.forEach((_, id) => {
      if (!prev.map.has(id) && !(prev2 && prev2.map.has(id))) n += 1;
    });
    newBuyers = n;
  }

  // 전월 신규 구매자(전전월에 없던 사람)가 당월 다시 구매한 비율 — 3개월 데이터 필요
  let newBuyerRetention: MemberMetrics["newBuyerRetention"] = null;
  if (prev && prev2) {
    let newPrev = 0;
    let retained = 0;
    prev.map.forEach((_, id) => {
      if (!prev2.map.has(id)) {
        newPrev += 1;
        if (cur.map.has(id)) retained += 1;
      }
    });
    if (newPrev > 0) newBuyerRetention = { newPrev, retained, rate: round1((retained / newPrev) * 100) };
  }

  return {
    months: months.map((m) => m.yearMonth),
    buyers,
    orders,
    amount,
    frequency,
    frequencyMonths: months.map((m) => m.yearMonth),
    pareto,
    retention,
    newBuyers,
    newBuyerRetention,
    truncated: months.some((m) => m.truncated),
  };
}

