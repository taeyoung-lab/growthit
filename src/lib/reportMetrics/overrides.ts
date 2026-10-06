// 화면④에서 담당자가 입력한 값(overrides) 검증·정리 — 클라이언트 입력을 그대로 Firestore에 넣지 않습니다.

import type { ActionItem, ActionReview, GoalItem, ReportOverrides } from "./types";

function rate(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("수수료율은 0~100 사이 숫자여야 합니다.");
  return Math.round(n * 100) / 100;
}
function text(v: unknown, max = 200): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function list<T>(v: unknown, max: number, map: (x: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v.slice(0, max)) {
    if (x && typeof x === "object") {
      const m = map(x as Record<string, unknown>);
      if (m) out.push(m);
    }
  }
  return out;
}

export function sanitizeOverrides(raw: unknown): ReportOverrides {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ReportOverrides = {};
  const d = rate(o.fee_delivery_rate);
  const p = rate(o.fee_pickup_rate);
  const b = rate(o.benchmark_rate);
  if (d !== undefined) out.fee_delivery_rate = d;
  if (p !== undefined) out.fee_pickup_rate = p;
  if (b !== undefined) out.benchmark_rate = b;
  out.next_goals = list<GoalItem>(o.next_goals, 10, (x) => {
    const metric = text(x.metric, 60);
    const target = text(x.target, 60);
    return metric || target ? { metric, target } : null;
  });
  out.actions = list<ActionItem>(o.actions, 10, (x) => {
    const title = text(x.title, 100);
    return title ? { title, owner: text(x.owner, 40), due: text(x.due, 10) } : null;
  });
  out.prev_review = list<ActionReview>(o.prev_review, 10, (x) => {
    const title = text(x.title, 100);
    const status = x.status === "DONE" || x.status === "PARTIAL" ? x.status : "TODO";
    return title ? { title, status, comment: text(x.comment, 120) } : null;
  });
  out.note = text(o.note, 500);
  return out;
}

