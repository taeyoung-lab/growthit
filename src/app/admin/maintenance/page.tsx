"use client";

import { useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { authedFetch } from "@/lib/apiClient";

type Result = {
  applied: boolean;
  meetingsScanned: number;
  docsToUpdate: number;
  meetingsAffected: Array<{ id: string; title: string; before: number; after: number; childDocs: number }>;
};

function MaintenanceContent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run(apply: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = (await authedFetch("/api/admin/backfill-member-uids", {
        method: "POST",
        body: JSON.stringify({ apply }),
      })) as Result;
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-xl font-bold text-navy">회의록 접근 정보 보정 (슈퍼 관리자 전용)</h1>
        <p className="mb-6 text-sm text-gray-500">
          예전에 만든 회의록의 참여자 정보(member_uids)를 채워서, 직원 계정의 대시보드에서도 본인이 참여한 회의록이 보이게 합니다.
          먼저 &quot;점검&quot;으로 대상만 확인하고, 문제가 없으면 &quot;적용&quot;을 누르세요. 기존 참여자는 지우지 않고 합칩니다.
        </p>

        <div className="mb-6 flex gap-2">
          <button className="btn btn-secondary" disabled={busy} onClick={() => run(false)}>
            {busy ? "처리 중…" : "점검 (쓰기 없음)"}
          </button>
          <button className="btn btn-primary" disabled={busy || !result || result.applied || result.docsToUpdate === 0} onClick={() => run(true)}>
            적용
          </button>
        </div>

        {error && <p className="card mb-4 p-4 text-sm text-red-600">{error}</p>}

        {result && (
          <div className="card p-4 text-sm">
            <p className="font-medium text-ink">
              {result.applied ? "적용 완료" : "점검 결과"} · 회의록 {result.meetingsScanned}건 확인 · 갱신 대상 문서 {result.docsToUpdate}건
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {result.meetingsAffected.map((m) => (
                <div key={m.id} className="rounded-lg bg-gray-50 p-3 text-xs">
                  <div className="font-medium text-ink">{m.title || m.id}</div>
                  <div className="mt-1 text-gray-500">
                    참여자 {m.before}명 → {m.after}명 · 하위 문서(과제/질의/결정/연결) {m.childDocs}건
                  </div>
                </div>
              ))}
              {result.meetingsAffected.length === 0 && <p className="text-gray-400">보정할 항목이 없습니다.</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function MaintenancePage() {
  return (
    <AuthGate>
      <MaintenanceContent />
    </AuthGate>
  );
}
