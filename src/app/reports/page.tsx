"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { authedFetch } from "@/lib/apiClient";
import type { ReportBrand } from "@/lib/types";

// 그로스잇 브랜드 정기 성과 리포트 자동화 — "Monthly Report 발행" 메뉴 (기획 문서 "Monthly Report
// 발행 — 화면 설계" 탭의 화면①~⑤ 중 화면①(브랜드/월 선택)·②(계정 입력)을 구현합니다.
//
// 화면③(데이터 수집 중 — 단계별 진행률 표시)·④(데이터 수집 완료 — 8개 섹션 검수·수정 + 수수료
// 키인)·⑤(리포트 발행 완료 — PPT 다운로드)는 아직 구현 전입니다. 이 화면에서는 그 세 단계를
// /api/brands/{id}/collect 호출 1번(이미 구현된 엔드포인트)으로 압축한 임시 결과 화면으로 대신하고
// 있습니다 — brands/page.tsx의 "지금 수집(테스트)" 버튼과 동일한 API를 쓰되, 화면①~②의 정식
// 플로우(브랜드·월 선택 → 계정 확인) 안에 놓은 것이 차이입니다.
//
// 계정 입력(화면②) 설계 노트: 기획 문서는 "저장된 계정이 있으면 아이디·비밀번호가 자동으로 채워진
// 상태로 표시"라고 돼 있지만, brandCredentials 컬렉션은 firestore.rules가 클라이언트 read를 전면
// 차단하고 있어(비밀번호 평문은 물론 아이디도) 애초에 클라이언트로 내려줄 수 없습니다. 대신
// has_saved_credentials 플래그만으로 "저장된 계정을 그대로 재사용합니다"를 안내하고, 실제 로그인은
// /api/brands/{id}/collect가 서버에서 brandCredentials를 복호화해 처리합니다(기존 구조 그대로).
// 계정이 아직 없는 브랜드만 이 화면에서 새로 입력받아 /api/brands(PATCH)로 저장합니다.

type Step = "select" | "credentials" | "collecting" | "done" | "error";

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
  const [collectSummary, setCollectSummary] = useState<string | null>(null);
  const [collectNotice, setCollectNotice] = useState<string | null>(null);

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
      setCollectSummary(
        `${yearMonth} 데이터 수집 완료 — 대시보드: ${JSON.stringify(result.data?.data?.dashboard ?? {}).slice(0, 200)}`
      );
      // 정산 JSON이 CMS 타임아웃으로 실패해 엑셀 다운로드로 대체된 달은 값이 조금 다를 수 있어 알립니다.
      setCollectNotice(
        result.data?.data?.settlementSource === "EXCEL_FALLBACK"
          ? "정산 데이터는 CMS 정산 조회가 지연돼 엑셀 다운로드 경로로 대신 가져왔습니다. 서비스이용료 세부 내역은 없고, 폐업 매장 등의 마이너스 조정 값은 CMS 화면과 다를 수 있습니다."
          : null
      );
      setStep("done");
    } catch (e) {
      console.error("[ReportsPage] 데이터 수집 실패:", e);
      setErrorMessage(e instanceof Error ? e.message : "데이터 수집에 실패했습니다.");
      setStep("error");
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setStep("select");
    setBrandId("");
    setYearMonth(currentYearMonth());
    setMonthlyStatus(null);
    setCollectSummary(null);
    setCollectNotice(null);
    setErrorMessage(null);
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="mb-1 text-xl font-bold text-navy">Monthly Report 발행</h1>
        <p className="mb-6 text-sm text-gray-400">
          {step === "select" && "화면① · 발행할 브랜드와 연월을 선택하세요"}
          {step === "credentials" && "화면② · CMS 계정을 확인하세요"}
          {step === "collecting" && "화면③ · 데이터 수집 중(임시 화면)"}
          {step === "done" && "화면③~⑤ 임시 결과 (정식 검수·수정·PPT 발행 화면은 구현 예정)"}
          {step === "error" && "오류가 발생했습니다"}
        </p>

        {loadError && <p className="card mb-4 p-4 text-sm text-red-600">{loadError}</p>}

        {step === "select" && (
          <div className="card flex flex-col gap-4 p-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">브랜드</label>
              <select
                className="input w-full"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
              >
                <option value="">브랜드를 선택하세요</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.brand_name} ({b.company_name})
                  </option>
                ))}
              </select>
              {!loadError && brands.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">
                  활성화된 브랜드가 없습니다 — 브랜드 관리 화면에서 먼저 등록해주세요.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">대상 연·월</label>
              <input
                className="input w-full"
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
              />
            </div>
            {statusLoading && <p className="text-xs text-gray-400">발행 이력 확인 중...</p>}
            {!statusLoading && monthlyStatus?.exists && (
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                이 브랜드·월은 이미 {monthlyStatus.published ? "발행" : "수집"}된 데이터가 있습니다
                {monthlyStatus.source === "BACKFILL" && " (백필로 수집됨)"}. 계속 진행하면 최신 데이터로
                덮어씁니다.
              </p>
            )}
            <div className="flex justify-end">
              <button
                className="btn btn-primary"
                disabled={!brandId || !yearMonth}
                onClick={goToCredentials}
              >
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
                  이 브랜드는 저장된 CMS 계정이 없습니다. 최초 1회만 입력하면 다음 달부터 자동으로
                  재사용됩니다.
                </p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">CMS 아이디</label>
                  <input
                    className="input w-full"
                    value={cmsUsername}
                    onChange={(e) => setCmsUsername(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">CMS 비밀번호</label>
                  <input
                    className="input w-full"
                    type="password"
                    value={cmsPassword}
                    onChange={(e) => setCmsPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                {selectedBrand.phone_verification_required && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      전화번호 인증 고정값
                    </label>
                    <input
                      className="input w-full"
                      value={fixedVerificationCode}
                      onChange={(e) => setFixedVerificationCode(e.target.value)}
                      autoComplete="off"
                    />
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
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-ink">CMS 로그인 및 데이터 수집 중입니다...</p>
            <p className="text-xs text-gray-400">브랜드에 따라 최대 1~2분 정도 걸릴 수 있습니다.</p>
          </div>
        )}

        {step === "done" && (
          <div className="card flex flex-col gap-4 p-6">
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">수집에 성공했습니다.</p>
            {collectNotice && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{collectNotice}</p>}
            {collectSummary && <p className="break-all text-xs text-gray-500">{collectSummary}</p>}
            <p className="text-xs text-gray-400">
              검수·수정(화면④)과 PPT 발행(화면⑤)은 아직 구현되지 않았습니다 — 수집된 원본 데이터는
              brandMonthlyData에 저장되어 있어, 해당 화면 구현 시 그대로 이어받아 쓸 수 있습니다.
            </p>
            <div className="flex justify-end">
              <button className="btn btn-primary" onClick={resetAll}>
                다른 브랜드/월 발행
              </button>
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

