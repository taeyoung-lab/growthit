"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { authedFetch, authedFetchBlob } from "@/lib/apiClient";
import { buildReportModel } from "@/lib/reportMetrics/buildReportModel";
import { fmtNum, fmtPct, fmtSigned, fmtWon, monthLabel } from "@/lib/reportMetrics/format";
import type { ActionItem, ActionReview, GoalItem, Kpi, ReportInput, ReportOverrides } from "@/lib/reportMetrics/types";
import { DEFAULT_BENCHMARK_FEE_RATE, type ReportBrand } from "@/lib/types";

// 그로스잇 브랜드 정기 성과 리포트 자동화 — "Monthly Report 발행" 메뉴 (기획 문서 "Monthly Report
// 발행 — 화면 설계" 탭의 화면①~⑤ 중 화면①(브랜드/월 선택)·②(계정 입력)을 구현합니다.
//
// 2026-10-06: 화면③(수집 진행)·④(지표 미리보기·검수·수수료/목표/액션 입력)·⑤(PPT 발행·발행 이력)을
// 구현했습니다. ④의 지표는 서버가 내려준 저장 데이터(ReportInput)를 클라이언트에서 buildReportModel로
// 즉시 다시 계산하므로, 수수료율을 고치면 절감액·ROI가 바로 바뀝니다. 이미 수집된 달은 ①에서 재수집 없이
// 바로 ④로 들어갈 수 있습니다.
//
// 계정 입력(화면②) 설계 노트: 기획 문서는 "저장된 계정이 있으면 아이디·비밀번호가 자동으로 채워진
// 상태로 표시"라고 돼 있지만, brandCredentials 컬렉션은 firestore.rules가 클라이언트 read를 전면
// 차단하고 있어(비밀번호 평문은 물론 아이디도) 애초에 클라이언트로 내려줄 수 없습니다. 대신
// has_saved_credentials 플래그만으로 "저장된 계정을 그대로 재사용합니다"를 안내하고, 실제 로그인은
// /api/brands/{id}/collect가 서버에서 brandCredentials를 복호화해 처리합니다(기존 구조 그대로).
// 계정이 아직 없는 브랜드만 이 화면에서 새로 입력받아 /api/brands(PATCH)로 저장합니다.

type Step = "select" | "credentials" | "collecting" | "review" | "published" | "error";

interface MonthlyStatus {
  exists: boolean;
  published: boolean;
  collected_at: number | null;
  source: "MANUAL" | "BACKFILL" | null;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

interface HistoryItem {
  id: string;
  year_month: string;
  file_name: string | null;
  published_at: number;
}

const COLLECT_STEPS = ["CMS 로그인", "매출·정산·매장 데이터 수집", "메뉴·회원·쿠폰·이벤트 수집", "주문 집계(요일·시간대·회원별 구매)", "저장"];

function rateStr(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}
function parseRate(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function KpiCard({ k }: { k: Kpi }) {
  const val =
    k.value == null ? "-" : k.unit === "%" ? fmtPct(k.value, 2) : k.unit === "원" ? fmtWon(k.value) : `${fmtNum(k.value)}${k.unit}`;
  const delta =
    k.pct == null ? "전월 비교 없음" : `전월 대비 ${fmtSigned(k.pct, k.unit === "%" ? "%p" : "%")}${k.pctSource === "CMS" ? " (CMS 제공)" : ""}`;
  const color = k.pct == null || k.pct === 0 ? "text-gray-400" : k.pct > 0 ? "text-emerald-600" : "text-red-600";
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{k.label}</p>
      <p className="mt-1 break-all text-base font-bold text-navy">{val}</p>
      <p className={`mt-1 text-[11px] ${color}`}>{delta}</p>
    </div>
  );
}

function ReportsContent() {
  const { profile } = useAuth();
  const [brands, setBrands] = useState<ReportBrand[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("select");
  const [brandId, setBrandId] = useState("");
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  const [cmsUsername, setCmsUsername] = useState("");
  const [cmsPassword, setCmsPassword] = useState("");
  const [fixedVerificationCode, setFixedVerificationCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [collectNotice, setCollectNotice] = useState<string | null>(null);
  const [progressIdx, setProgressIdx] = useState(0);

  // 화면④ 상태
  const [input, setInput] = useState<ReportInput | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [feeD, setFeeD] = useState("");
  const [feeP, setFeeP] = useState("");
  const [bench, setBench] = useState("");
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [review, setReview] = useState<ActionReview[]>([]);
  const [note, setNote] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ blob: Blob; fileName: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const selectedBrand = brands.find((b) => b.id === brandId) ?? null;

  useEffect(() => {
    async function load() {
      if (!profile) return;
      try {
        setLoadError(null);
        // brands/page.tsx와 동일한 패턴 — 비활성화된 브랜드는 발행 대상에서 제외합니다
        // (기획 문서 화면① "비고": 비활성화된 브랜드는 목록에서 제외).
        const snap = await getDocs(
          query(collection(db, "brands"), where("organization_id", "==", profile.organization_id))
        );
        const loaded = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as ReportBrand))
          .filter((b) => b.brand_status !== "INACTIVE");
        loaded.sort((a, b) => a.brand_name.localeCompare(b.brand_name));
        setBrands(loaded);
      } catch (error) {
        console.error("[ReportsPage] 브랜드 목록 조회 실패:", error);
        setLoadError("브랜드 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    }
    load();
  }, [profile]);

  // 브랜드·연월이 둘 다 정해지면 "기존 발행 이력 유무"를 조회합니다(화면① 비고: 과거 월 재발행 시
  // 표시). 선택이 바뀔 때마다 새로 조회하고, 이전 조회 결과가 다른 조합에 섞여 보이지 않도록 비웁니다.
  useEffect(() => {
    setMonthlyStatus(null);
    if (!brandId || !/^\d{4}-\d{2}$/.test(yearMonth)) return;
    let cancelled = false;
    setStatusLoading(true);
    authedFetch(`/api/brands/${brandId}/monthly-data?year_month=${yearMonth}`)
      .then((data) => {
        if (!cancelled) setMonthlyStatus(data);
      })
      .catch((e) => {
        console.error("[ReportsPage] 발행 이력 조회 실패:", e);
      })
      .finally(() => {
        if (!cancelled) setStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, yearMonth]);

  // 수집 중에는 단계 표시를 시간 경과에 맞춰 넘깁니다(실제 단계별 진행률은 서버가 알려주지 않는 한 호출이라
  // 근사치 — 마지막 단계는 응답이 올 때까지 머무름).
  useEffect(() => {
    if (step !== "collecting") return;
    setProgressIdx(0);
    const t = setInterval(() => setProgressIdx((i) => Math.min(i + 1, COLLECT_STEPS.length - 1)), 4500);
    return () => clearInterval(t);
  }, [step]);

  function goToCredentials() {
    setErrorMessage(null);
    setCmsUsername("");
    setCmsPassword("");
    setFixedVerificationCode("");
    setStep("credentials");
  }

  function backToSelect() {
    setErrorMessage(null);
    setStep("select");
  }

  // 저장된 입력(overrides)을 화면 상태로 풀어 넣습니다. 수수료는 이번 달 입력 → 없으면 브랜드 기본값.
  function hydrate(inp: ReportInput) {
    const o = inp.overrides ?? {};
    const fd = inp.feeDefaults;
    setFeeD(rateStr(o.fee_delivery_rate ?? fd?.delivery_rate));
    setFeeP(rateStr(o.fee_pickup_rate ?? fd?.pickup_rate));
    setBench(rateStr(o.benchmark_rate ?? fd?.benchmark_rate ?? DEFAULT_BENCHMARK_FEE_RATE));
    setGoals(o.next_goals ?? []);
    setActions(o.actions ?? []);
    const prevReview = o.prev_review ?? [];
    setReview(
      inp.prevActions.map((a) => prevReview.find((r) => r.title === a.title) ?? { title: a.title, status: "TODO", comment: "" })
    );
    setNote(o.note ?? "");
    setSaveMessage(null);
    setPublished(null);
  }

  async function openReview() {
    if (!selectedBrand) return;
    setErrorMessage(null);
    setReviewLoading(true);
    try {
      const data = await authedFetch(`/api/brands/${selectedBrand.id}/report?year_month=${yearMonth}`);
      setInput(data.input as ReportInput);
      hydrate(data.input as ReportInput);
      setStep("review");
    } catch (e) {
      console.error("[ReportsPage] 리포트 데이터 조회 실패:", e);
      setErrorMessage(e instanceof Error ? e.message : "리포트 데이터를 불러오지 못했습니다.");
      setStep("error");
    } finally {
      setReviewLoading(false);
    }
  }

  async function startCollection() {
    if (!selectedBrand) return;
    setErrorMessage(null);

    const needsNewCredentials = !selectedBrand.has_saved_credentials;
    if (needsNewCredentials && (!cmsUsername.trim() || !cmsPassword.trim())) {
      setErrorMessage("CMS 아이디와 비밀번호를 입력해주세요.");
      return;
    }
    if (needsNewCredentials && selectedBrand.phone_verification_required && !fixedVerificationCode.trim()) {
      setErrorMessage("이 브랜드는 전화번호 인증이 필요합니다. 고정 인증번호를 입력해주세요.");
      return;
    }

    setSubmitting(true);
    try {
      if (needsNewCredentials) {
        // 계정이 아직 없는 브랜드 — 기존 브랜드 수정 API(PATCH /api/brands)를 그대로 재사용해
        // brandCredentials에 암호화 저장합니다(brands/page.tsx의 수정 모달과 동일한 경로).
        await authedFetch("/api/brands", {
          method: "PATCH",
          body: JSON.stringify({
            id: selectedBrand.id,
            company_name: selectedBrand.company_name,
            brand_name: selectedBrand.brand_name,
            cms_url: selectedBrand.cms_url,
            manager_name: selectedBrand.manager_name,
            phone_verification_required: selectedBrand.phone_verification_required,
            service_open_date: selectedBrand.service_open_date,
            cms_username: cmsUsername.trim(),
            cms_password: cmsPassword,
            fixed_verification_code: fixedVerificationCode.trim() || null,
          }),
        });
      }

      setStep("collecting");
      const result = await authedFetch(`/api/brands/${selectedBrand.id}/collect`, {
        method: "POST",
        body: JSON.stringify({ year_month: yearMonth }),
      });
      // 정산 JSON이 CMS 타임아웃으로 실패해 엑셀 다운로드로 대체된 달은 값이 조금 다를 수 있어 알립니다.
      setCollectNotice(
        result.data?.data?.settlementSource === "EXCEL_FALLBACK"
          ? "정산 데이터는 CMS 정산 조회가 지연돼 엑셀 다운로드 경로로 대신 가져왔습니다. 폐업 매장 등의 마이너스 조정 값은 CMS 화면과 다를 수 있습니다."
          : null
      );
      await openReview();
    } catch (e) {
      console.error("[ReportsPage] 데이터 수집 실패:", e);
      setErrorMessage(e instanceof Error ? e.message : "데이터 수집에 실패했습니다.");
      setStep("error");
    } finally {
      setSubmitting(false);
    }
  }

  // 화면④에서 입력 중인 값 → 저장/계산용 overrides
  const overrides: ReportOverrides = useMemo(
    () => ({
      fee_delivery_rate: parseRate(feeD),
      fee_pickup_rate: parseRate(feeP),
      benchmark_rate: parseRate(bench),
      next_goals: goals,
      actions,
      prev_review: review,
      note,
    }),
    [feeD, feeP, bench, goals, actions, review, note]
  );
  const model = useMemo(() => (input ? buildReportModel({ ...input, overrides }) : null), [input, overrides]);

  async function saveDraft() {
    if (!selectedBrand) return;
    setSaveMessage(null);
    try {
      await authedFetch(`/api/brands/${selectedBrand.id}/report`, {
        method: "PUT",
        body: JSON.stringify({ year_month: yearMonth, overrides }),
      });
      setSaveMessage("저장했습니다.");
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "저장에 실패했습니다.");
    }
  }

  async function loadHistory(id: string) {
    try {
      const data = await authedFetch(`/api/brands/${id}/report/history`);
      setHistory(data.items ?? []);
    } catch (e) {
      console.error("[ReportsPage] 발행 이력 조회 실패:", e);
    }
  }

  async function publish() {
    if (!selectedBrand) return;
    setPublishing(true);
    setSaveMessage(null);
    try {
      const { blob, fileName } = await authedFetchBlob(`/api/brands/${selectedBrand.id}/report/publish`, {
        method: "POST",
        body: JSON.stringify({ year_month: yearMonth, overrides }),
      });
      const name = fileName ?? `${selectedBrand.brand_name}_${yearMonth.replace("-", "")}_성과리포트.pptx`;
      setPublished({ blob, fileName: name });
      downloadBlob(blob, name);
      await loadHistory(selectedBrand.id);
      setStep("published");
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : "리포트 발행에 실패했습니다.");
    } finally {
      setPublishing(false);
    }
  }

  function resetAll() {
    setStep("select");
    setBrandId("");
    setYearMonth(currentYearMonth());
    setMonthlyStatus(null);
    setCollectNotice(null);
    setErrorMessage(null);
    setInput(null);
    setPublished(null);
    setHistory([]);
  }

  const wide = step === "review" || step === "published";
  const subtitle =
    step === "select" ? "화면① · 발행할 브랜드와 연월을 선택하세요"
    : step === "credentials" ? "화면② · CMS 계정을 확인하세요"
    : step === "collecting" ? "화면③ · 데이터 수집 중"
    : step === "review" ? "화면④ · 수집 데이터를 검수하고 수수료·목표·액션을 입력하세요"
    : step === "published" ? "화면⑤ · 리포트 발행 완료"
    : "오류가 발생했습니다";

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className={`mx-auto px-6 py-8 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
        <h1 className="mb-1 text-xl font-bold text-navy">Monthly Report 발행</h1>
        <p className="mb-6 text-sm text-gray-400">{subtitle}</p>

        {loadError && <p className="card mb-4 p-4 text-sm text-red-600">{loadError}</p>}

        {step === "select" && (
          <div className="card flex flex-col gap-4 p-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">브랜드</label>
              <select className="input w-full" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">브랜드를 선택하세요</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.brand_name} ({b.company_name})
                  </option>
                ))}
              </select>
              {!loadError && brands.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">활성화된 브랜드가 없습니다 — 브랜드 관리 화면에서 먼저 등록해주세요.</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">대상 연·월</label>
              <input className="input w-full" type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} />
            </div>
            {statusLoading && <p className="text-xs text-gray-400">발행 이력 확인 중...</p>}
            {!statusLoading && monthlyStatus?.exists && (
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                이 브랜드·월은 이미 {monthlyStatus.published ? "발행" : "수집"}된 데이터가 있습니다
                {monthlyStatus.source === "BACKFILL" && " (백필로 수집됨)"}. 다시 수집하면 최신 데이터로 덮어쓰고(입력한 수수료·목표는 유지),
                수집 없이 바로 검수하려면 아래 버튼을 누르세요.
              </p>
            )}
            <div className="flex justify-end gap-2">
              {monthlyStatus?.exists && (
                <button className="btn btn-secondary" disabled={reviewLoading} onClick={openReview}>
                  {reviewLoading ? "불러오는 중..." : "수집 없이 검수하기"}
                </button>
              )}
              <button className="btn btn-primary" disabled={!brandId || !yearMonth} onClick={goToCredentials}>
                다음
              </button>
            </div>
          </div>
        )}

        {step === "credentials" && selectedBrand && (
          <div className="card flex flex-col gap-4 p-6">
            <div className="text-sm text-ink">
              <span className="font-medium">{selectedBrand.brand_name}</span>
              <span className="text-gray-400"> · {yearMonth}</span>
            </div>

            {selectedBrand.has_saved_credentials ? (
              <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
                저장된 CMS 계정으로 자동 로그인합니다. 계정 정보를 다시 입력할 필요가 없습니다.
                {selectedBrand.phone_verification_required && " (전화번호 인증 고정값도 저장돼 있습니다.)"}
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-400">
                  이 브랜드는 저장된 CMS 계정이 없습니다. 최초 1회만 입력하면 다음 달부터 자동으로 재사용됩니다.
                </p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">CMS 아이디</label>
                  <input className="input w-full" value={cmsUsername} onChange={(e) => setCmsUsername(e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">CMS 비밀번호</label>
                  <input className="input w-full" type="password" value={cmsPassword} onChange={(e) => setCmsPassword(e.target.value)} autoComplete="new-password" />
                </div>
                {selectedBrand.phone_verification_required && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">전화번호 인증 고정값</label>
                    <input className="input w-full" value={fixedVerificationCode} onChange={(e) => setFixedVerificationCode(e.target.value)} autoComplete="off" />
                  </div>
                )}
              </>
            )}

            {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

            <div className="flex justify-between">
              <button className="btn btn-secondary" onClick={backToSelect} disabled={submitting}>
                이전
              </button>
              <button className="btn btn-primary" onClick={startCollection} disabled={submitting}>
                {submitting ? "처리 중..." : "데이터 수집 시작"}
              </button>
            </div>
          </div>
        )}

        {step === "collecting" && (
          <div className="card flex flex-col gap-4 p-8">
            <p className="text-sm font-medium text-ink">CMS에서 데이터를 가져오고 있습니다 (보통 20~60초)</p>
            <ol className="flex flex-col gap-2">
              {COLLECT_STEPS.map((label, i) => (
                <li key={label} className={`flex items-center gap-2 text-sm ${i < progressIdx ? "text-emerald-700" : i === progressIdx ? "font-medium text-navy" : "text-gray-300"}`}>
                  <span className="inline-block w-4 text-center">{i < progressIdx ? "✓" : i === progressIdx ? "●" : "○"}</span>
                  {label}
                </li>
              ))}
            </ol>
            <p className="text-xs text-gray-400">브랜드에 따라 최대 1~2분 걸릴 수 있습니다. 창을 닫지 마세요.</p>
          </div>
        )}

        {step === "review" && model && input && selectedBrand && (
          <div className="flex flex-col gap-5">
            <div className="card flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="text-sm text-ink">
                <span className="font-semibold">{selectedBrand.brand_name}</span>
                <span className="text-gray-400"> · {monthLabel(yearMonth)} 리포트</span>
              </div>
              <button className="text-xs text-gray-500 underline" onClick={backToSelect}>
                다른 브랜드/월 선택
              </button>
            </div>

            {collectNotice && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{collectNotice}</p>}

            <section className="card p-5">
              <h2 className="mb-3 text-sm font-bold text-navy">1. 핵심 지표 미리보기</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {model.summary.kpis.map((k) => (
                  <KpiCard key={k.key} k={k} />
                ))}
              </div>
              {model.summary.headlines.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-sm text-ink">
                  {model.summary.headlines.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-5">
              <h2 className="mb-1 text-sm font-bold text-navy">2. 채널 효율 — 그로스잇 수수료·배달앱 벤치마크</h2>
              <p className="mb-3 text-xs text-gray-400">
                절감액 = 그로스잇 매출액 × 배달앱 수수료(벤치마크) − 그로스잇 수수료. 브랜드 설정의 기본값이 자동으로 채워져 있습니다.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="text-xs text-gray-600">
                  그로스잇 배달 수수료율(%)
                  <input className="input mt-1 w-full" inputMode="decimal" value={feeD} onChange={(e) => setFeeD(e.target.value)} placeholder="예: 3.5" />
                </label>
                <label className="text-xs text-gray-600">
                  그로스잇 픽업 수수료율(%)
                  <input className="input mt-1 w-full" inputMode="decimal" value={feeP} onChange={(e) => setFeeP(e.target.value)} placeholder="예: 1.5" />
                </label>
                <label className="text-xs text-gray-600">
                  배달앱 수수료 벤치마크(%)
                  <input className="input mt-1 w-full" inputMode="decimal" value={bench} onChange={(e) => setBench(e.target.value)} placeholder={String(DEFAULT_BENCHMARK_FEE_RATE)} />
                </label>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                  앱 배달 매출
                  <p className="mt-1 text-sm font-bold text-navy">{fmtWon(model.channel.fee.deliveryPay)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                  앱 픽업 매출
                  <p className="mt-1 text-sm font-bold text-navy">{fmtWon(model.channel.fee.pickupPay)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                  그로스잇 수수료
                  <p className="mt-1 text-sm font-bold text-navy">{model.channel.fee.missingFee ? "수수료율 입력 필요" : fmtWon(model.channel.fee.growthitFee)}</p>
                </div>
                <div className="rounded-lg bg-navy p-3 text-xs text-slate-300">
                  절감액 / ROI
                  <p className="mt-1 text-sm font-bold text-mint">
                    {model.channel.fee.saving == null ? "계산 불가" : `${fmtWon(model.channel.fee.saving)}${model.channel.fee.roi != null ? ` · ${model.channel.fee.roi.toLocaleString("ko-KR")}%` : ""}`}
                  </p>
                </div>
              </div>
              {model.channel.cumulative && (
                <p className="mt-2 text-xs text-gray-500">
                  누적 절감액({model.channel.cumulative.months}개월, 현재 수수료율 기준 재계산): {fmtWon(model.channel.cumulative.saving)}
                </p>
              )}
            </section>

            <section className="card p-5">
              <h2 className="mb-3 text-sm font-bold text-navy">3. 섹션별 수치 확인</h2>
              <div className="grid grid-cols-1 gap-4 text-xs text-ink md:grid-cols-2">
                <div>
                  <p className="mb-1 font-semibold text-navy">매출·GMV</p>
                  <p>전체 매출액 {fmtWon(model.sales.totalPay)} (온라인 {fmtWon(model.sales.onlinePay)} · 오프라인 {fmtWon(model.sales.offlinePay)})</p>
                  <p>그로스잇 매출액 {fmtWon(model.sales.appPay)} · 앱 비중 {fmtPct(model.sales.appShare, 2)}</p>
                  <p>앱 주문 유형: {model.sales.byOrderType.map((o) => `${o.label} ${fmtWon(o.pay)}`).join(" / ") || "-"}</p>
                </div>
                <div>
                  <p className="mb-1 font-semibold text-navy">온라인 채널별</p>
                  {model.channel.channels.length === 0 ? <p>-</p> : model.channel.channels.map((c) => <p key={c.name}>{c.name} {fmtWon(c.pay)} ({fmtNum(c.orders)}건)</p>)}
                </div>
                <div>
                  <p className="mb-1 font-semibold text-navy">매장 운영</p>
                  <p>전체 {model.stores.counts.total}곳 (정상 {model.stores.counts.normal} · 폐업 {model.stores.counts.closed} · 개점전 {model.stores.counts.preOpen})</p>
                  <p>앱 매출 발생 {model.stores.appStores}곳 · 앱 미도입 {model.stores.notAdopted}곳</p>
                  <p>TOP: {model.stores.top.slice(0, 3).map((t) => `${t.name} ${fmtWon(t.appPay)}`).join(" / ") || "-"}</p>
                </div>
                <div>
                  <p className="mb-1 font-semibold text-navy">멤버십·고객</p>
                  <p>회원 {fmtNum(model.members.total)}명 · 신규 {fmtNum(model.members.newMembers)}명</p>
                  <p>세그먼트: {model.members.segments.map((s) => `${s.label} ${s.rate}%`).join(" / ") || "-"}</p>
                  <p>인기 메뉴: {model.members.topItems.slice(0, 3).map((t) => t.name).join(", ") || "-"}</p>
                  {model.members.buyers && (
                    <p>
                      재구매율 {model.members.buyers.retention ? fmtPct(model.members.buyers.retention.rate) : "-"} · 상위 20% 결제 비중{" "}
                      {model.members.buyers.pareto ? fmtPct(model.members.buyers.pareto.top20Share) : "-"}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="card p-5">
              <h2 className="mb-3 text-sm font-bold text-navy">4. 익월 목표 및 액션 아이템 (직접 입력)</h2>

              <p className="mb-1 text-xs font-medium text-gray-600">익월 목표</p>
              {goals.map((g, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input className="input flex-1" placeholder="지표 (예: 앱 비중)" value={g.metric} onChange={(e) => setGoals(goals.map((x, j) => (j === i ? { ...x, metric: e.target.value } : x)))} />
                  <input className="input flex-1" placeholder="목표 (예: 6.5%)" value={g.target} onChange={(e) => setGoals(goals.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
                  <button className="btn btn-secondary" onClick={() => setGoals(goals.filter((_, j) => j !== i))}>삭제</button>
                </div>
              ))}
              {goals.length < 10 && (
                <button className="btn btn-secondary mb-4" onClick={() => setGoals([...goals, { metric: "", target: "" }])}>+ 목표 추가</button>
              )}

              <p className="mb-1 mt-2 text-xs font-medium text-gray-600">익월 액션 아이템</p>
              {actions.map((a, i) => (
                <div key={i} className="mb-2 flex flex-wrap gap-2">
                  <input className="input min-w-[12rem] flex-[2]" placeholder="액션" value={a.title} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  <input className="input flex-1" placeholder="담당" value={a.owner} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)))} />
                  <input className="input flex-1" type="date" value={a.due} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
                  <button className="btn btn-secondary" onClick={() => setActions(actions.filter((_, j) => j !== i))}>삭제</button>
                </div>
              ))}
              {actions.length < 10 && (
                <button className="btn btn-secondary mb-2" onClick={() => setActions([...actions, { title: "", owner: "", due: "" }])}>+ 액션 추가</button>
              )}
              {model.plan.suggestions.length > 0 && (
                <div className="mt-2 rounded-md bg-emerald-50 p-3 text-xs text-emerald-900">
                  <p className="mb-1 font-semibold">데이터 기반 제안 (참고용 — 필요한 것만 위에 직접 입력하세요)</p>
                  <ul className="list-disc pl-5">
                    {model.plan.suggestions.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}

              {review.length > 0 && (
                <>
                  <p className="mb-1 mt-4 text-xs font-medium text-gray-600">전월 액션 이행 점검</p>
                  {review.map((r, i) => (
                    <div key={r.title} className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="min-w-[10rem] flex-[2] text-sm text-ink">{r.title}</span>
                      <select className="input" value={r.status} onChange={(e) => setReview(review.map((x, j) => (j === i ? { ...x, status: e.target.value as ActionReview["status"] } : x)))}>
                        <option value="DONE">완료</option>
                        <option value="PARTIAL">일부 진행</option>
                        <option value="TODO">미진행</option>
                      </select>
                      <input className="input flex-[2]" placeholder="코멘트" value={r.comment} onChange={(e) => setReview(review.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))} />
                    </div>
                  ))}
                </>
              )}

              <p className="mb-1 mt-4 text-xs font-medium text-gray-600">메모 (PPT 발표자 노트에 들어갑니다)</p>
              <textarea className="input w-full" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </section>

            <section className="card p-5">
              <h2 className="mb-2 text-sm font-bold text-navy">5. 데이터 체크리스트</h2>
              <ul className="text-xs">
                {model.checklist.map((c) => (
                  <li key={c.item} className={`flex gap-2 py-0.5 ${c.ok ? "text-gray-600" : "text-amber-700"}`}>
                    <span className="w-4">{c.ok ? "✓" : "!"}</span>
                    <span className="w-56 shrink-0">{c.item}</span>
                    <span className="text-gray-400">{c.note}</span>
                  </li>
                ))}
              </ul>
            </section>

            {saveMessage && <p className="text-sm text-ink">{saveMessage}</p>}
            <div className="flex justify-between">
              <button className="btn btn-secondary" onClick={saveDraft} disabled={publishing}>
                입력값 임시 저장
              </button>
              <button className="btn btn-primary" onClick={publish} disabled={publishing}>
                {publishing ? "PPT 생성 중..." : "리포트 발행 (PPT 다운로드)"}
              </button>
            </div>
          </div>
        )}

        {step === "published" && selectedBrand && published && (
          <div className="flex flex-col gap-4">
            <div className="card flex flex-col gap-3 p-6">
              <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
                {selectedBrand.brand_name} {monthLabel(yearMonth)} 리포트를 발행했습니다. PPT가 자동으로 다운로드됩니다.
              </p>
              <p className="text-xs text-gray-500">{published.fileName}</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-secondary" onClick={() => downloadBlob(published.blob, published.fileName)}>
                  다시 다운로드
                </button>
                <button className="btn btn-secondary" onClick={() => setStep("review")}>
                  검수 화면으로 돌아가기
                </button>
                <button className="btn btn-primary" onClick={resetAll}>
                  다른 브랜드/월 발행
                </button>
              </div>
            </div>
            <div className="card p-5">
              <h2 className="mb-2 text-sm font-bold text-navy">{selectedBrand.brand_name} 발행 이력</h2>
              {history.length === 0 ? (
                <p className="text-xs text-gray-400">발행 이력이 없습니다.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400">
                      <th className="py-1">대상 월</th>
                      <th>파일</th>
                      <th>발행 일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-t border-gray-100">
                        <td className="py-1">{h.year_month}</td>
                        <td>{h.file_name ?? "-"}</td>
                        <td>{new Date(h.published_at).toLocaleString("ko-KR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="card flex flex-col gap-4 p-6">
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{errorMessage}</p>
            <div className="flex justify-between">
              <button className="btn btn-secondary" onClick={backToSelect}>
                처음으로
              </button>
              <button className="btn btn-primary" onClick={() => setStep("credentials")}>
                다시 시도
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <AuthGate>
      <ReportsContent />
    </AuthGate>
  );
}
