// 월별 매장·메뉴 전체 목록(MonthBreakdown)으로 "기존/신규 매장 증감 분해"와 "메뉴 변화"를 계산하는 순수 함수.
// 팀 월간 리포트 정의를 따릅니다 — 기존 매장 = 직전 2개월 연속 앱 주문(결제)이 있던 매장, 금액은 일평균 기준,
// 메뉴는 월 판매수량 2,000개 이상인 메뉴만(수량 필드가 없으면 앱결제액 기준으로 대체).

import type { MonthBreakdown } from "@/lib/cmsAutomation/collectExtras";
import { round1 } from "./util";

export interface GrowthSplit {
  basis: "2개월 연속" | "직전 1개월"; // 기존 매장 판정 기준(전전월 데이터가 없으면 1개월)
  totalDelta: number; // 일평균 앱결제액 증감
  sameDelta: number; // 기존 매장 기여
  otherDelta: number; // 신규 오픈 등 기타 기여
  sameStores: number;
  sameChgPct: number | null; // 기존 매장 일평균 매출 성장률
  newStores: number; // 이번 달 처음 앱 결제가 생긴 매장
  activeStores: number; // 이번 달 앱 결제가 있는 매장
  decliners: { count: number; ratePct: number | null }; // 기존 매장 중 일평균 20% 이상 줄어든 매장
  topGainers: { name: string; delta: number }[]; // 기존 매장 중 일평균 증가액 상위
}
export interface MenuChange {
  basis: "수량" | "결제액";
  threshold: number;
  up: { name: string; cur: number; prev: number; chg: number }[];
  down: { name: string; cur: number; prev: number; chg: number }[];
  added: { name: string; cur: number }[];
}

const keyOf = (id: number, nm: string) => (id >= 0 ? `id:${id}` : `nm:${nm}`);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export function computeGrowthSplit(cur: MonthBreakdown, prev: MonthBreakdown, prev2: MonthBreakdown | null, days: number, pdays: number): GrowthSplit | null {
  if (cur.stores.id.length === 0 || prev.stores.id.length === 0) return null;
  const mapOf = (b: MonthBreakdown) => {
    const m = new Map<string, { nm: string; ap: number }>();
    b.stores.id.forEach((id, i) => m.set(keyOf(id, b.stores.nm[i]), { nm: b.stores.nm[i], ap: b.stores.ap[i] }));
    return m;
  };
  const c = mapOf(cur);
  const p = mapOf(prev);
  const p2 = prev2 && prev2.stores.id.length > 0 ? mapOf(prev2) : null;

  const totalDelta = sum(cur.stores.ap) / days - sum(prev.stores.ap) / pdays;
  let sameCur = 0;
  let samePrev = 0;
  let sameStores = 0;
  let newStores = 0;
  let activeStores = 0;
  let down = 0;
  const gainers: { name: string; delta: number }[] = [];
  c.forEach((v, k) => {
    if (v.ap <= 0) return;
    activeStores += 1;
    const pv = p.get(k)?.ap ?? 0;
    const p2v = p2 ? p2.get(k)?.ap ?? 0 : 1;
    if (pv <= 0) {
      newStores += 1;
      return;
    }
    if (p2v > 0) {
      sameStores += 1;
      sameCur += v.ap;
      samePrev += pv;
      const d = v.ap / days - pv / pdays;
      gainers.push({ name: v.nm, delta: d });
      if (pv / pdays > 0 && v.ap / days <= (pv / pdays) * 0.8) down += 1;
    }
  });
  // 이번 달 앱 결제가 없어진(휴·폐점 등) 기존 매장도 기존 매장 기여(감소분)에 포함해야 증감 합이 맞습니다.
  p.forEach((pv, k) => {
    if (pv.ap <= 0 || (c.get(k)?.ap ?? 0) > 0) return;
    const p2v = p2 ? p2.get(k)?.ap ?? 0 : 1;
    if (p2v > 0) {
      samePrev += pv.ap;
      sameStores += 0;
    }
  });
  const sameDelta = sameCur / days - samePrev / pdays;
  gainers.sort((a, b) => b.delta - a.delta);
  return {
    basis: p2 ? "2개월 연속" : "직전 1개월",
    totalDelta,
    sameDelta,
    otherDelta: totalDelta - sameDelta,
    sameStores,
    sameChgPct: samePrev > 0 ? round1(((sameCur / days) / (samePrev / pdays) - 1) * 100) : null,
    newStores,
    activeStores,
    decliners: { count: down, ratePct: sameStores > 0 ? round1((down / sameStores) * 100) : null },
    topGainers: gainers.slice(0, 3),
  };
}

// "아메리터(1L)"·"아메리터 (1L)", "연유큐브라떼"·"연유 큐브 라떼"처럼 표기만 다른 메뉴를 같은 메뉴로 묶습니다.
const norm = (s: string) => s.replace(/[\s()（）]/g, "").toLowerCase();

export function computeMenuChange(cur: MonthBreakdown, prev: MonthBreakdown, days: number, pdays: number): MenuChange | null {
  if (cur.items.key.length === 0 || prev.items.key.length === 0) return null;
  const hasQty = sum(cur.items.aq) > 0 && sum(prev.items.aq) > 0;
  const fold = (b: MonthBreakdown) => {
    const m = new Map<string, { name: string; v: number }>();
    b.items.key.forEach((_, i) => {
      const v = hasQty ? b.items.aq[i] : b.items.ap[i];
      if (v <= 0) return;
      const k = norm(b.items.nm[i]);
      const x = m.get(k);
      if (x) x.v += v;
      else m.set(k, { name: b.items.nm[i], v });
    });
    return m;
  };
  const c = fold(cur);
  const p = fold(prev);
  const threshold = hasQty ? 2000 : 5_000_000; // 월 판매수량 2,000개 / 앱결제액 500만원
  const up: MenuChange["up"] = [];
  const down: MenuChange["down"] = [];
  const added: MenuChange["added"] = [];
  const names = new Set<string>([...Array.from(c.keys()), ...Array.from(p.keys())]);
  names.forEach((k) => {
    const cv = c.get(k)?.v ?? 0;
    const pv = p.get(k)?.v ?? 0;
    const name = c.get(k)?.name ?? p.get(k)!.name;
    const curDay = cv / days;
    const prevDay = pv / pdays;
    if (pv <= 0 && cv >= threshold) added.push({ name, cur: cv });
    else if (pv > 0 && cv >= threshold && curDay > prevDay) up.push({ name, cur: Math.round(curDay), prev: Math.round(prevDay), chg: (curDay / prevDay - 1) * 100 });
    else if (pv >= threshold && curDay < prevDay) down.push({ name, cur: Math.round(curDay), prev: Math.round(prevDay), chg: (curDay / prevDay - 1) * 100 });
  });
  up.sort((a, b) => b.chg - a.chg);
  down.sort((a, b) => a.chg - b.chg);
  added.sort((a, b) => b.cur - a.cur);
  return { basis: hasQty ? "수량" : "결제액", threshold, up: up.slice(0, 3), down: down.slice(0, 3), added: added.slice(0, 3) };
}

