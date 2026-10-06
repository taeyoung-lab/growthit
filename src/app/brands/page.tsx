"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
import { authedFetch } from "@/lib/apiClient";
import type { ReportBrand } from "@/lib/types";

// 그로스잇 브랜드 정기 성과 리포트 자동화 — "Monthly Report 발행" 메뉴가 사용할 브랜드 설정을
// 관리하는 화면입니다. 로그인한 사용자 누구나 브랜드를 추가할 수 있고(등록자 = 담당자),
// 등록 후 CMS URL 등을 고치는 수정/비활성화는 담당자 본인 또는 슈퍼 관리자만 할 수 있습니다
// (firestore.rules의 /brands 규칙과 짝을 이룹니다 — 여기서는 UX상 버튼을 숨기는 정도로만
// 처리하고, 실제 권한 검증은 규칙이 담당합니다).

function BrandsContent() {
  const { profile } = useAuth();
  const [brands, setBrands] = useState<ReportBrand[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<"create" | ReportBrand | null>(null);
  const [confirmToggleId, setConfirmToggleId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  // CMS 자동 수집 모듈(collect.ts) 구현 완료 후 실제 환경에서 처음 돌려보기 위한 임시 트리거 —
  // 정식 "Monthly Report 발행" 메뉴(화면①~⑤)가 생기기 전까지, 브랜드 관리 화면에서 바로
  // /api/brands/{id}/collect를 한 번 호출해볼 수 있게 해 둡니다. 정식 발행 메뉴가 구현되면
  // 이 버튼은 제거하고 그쪽으로 옮겨도 됩니다.
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [collectResult, setCollectResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  // 백필(서비스 오픈일~전월 과거 데이터 일괄 수집) 수동 실행/이어하기 버튼 상태.
  const [backfillingId, setBackfillingId] = useState<string | null>(null);
  const [backfillResult, setBackfillResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  async function runCollect(b: ReportBrand) {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    setCollectingId(b.id);
    setCollectResult(null);
    try {
      const data = await authedFetch(`/api/brands/${b.id}/collect`, {
        method: "POST",
        body: JSON.stringify({ year_month: yearMonth }),
      });
      setCollectResult({
        id: b.id,
        ok: true,
        message: `수집 성공 (${data.year_month}) — 대시보드 매출: ${JSON.stringify(data.data?.data?.dashboard ?? {}).slice(0, 200)}`,
      });
    } catch (e) {
      console.error("[BrandsPage] 수집 실패:", e);
      setCollectResult({ id: b.id, ok: false, message: e instanceof Error ? e.message : "수집에 실패했습니다." });
    } finally {
      setCollectingId(null);
    }
  }

  async function runBackfill(b: ReportBrand) {
    setBackfillingId(b.id);
    setBackfillResult(null);
    try {
      const result = await authedFetch(`/api/brands/${b.id}/backfill`, { method: "POST" });
      const skippedNote =
        result.skippedMonths?.length > 0 ? ` (CMS 자체 문제로 건너뜀: ${result.skippedMonths.join(", ")})` : "";
      setBackfillResult({
        id: b.id,
        ok: true,
        message: result.done
          ? `백필 완료 — 서비스 오픈일부터 전월까지 전부 반영됐습니다.${skippedNote}`
          : `이번 실행에서 ${result.processedMonths.length}개월 처리함${skippedNote} — 아직 남아 있어 "백필 이어하기"를 다시 눌러주세요.`,
      });
      await load();
    } catch (e) {
      console.error("[BrandsPage] 백필 실패:", e);
      setBackfillResult({ id: b.id, ok: false, message: e instanceof Error ? e.message : "백필에 실패했습니다." });
    } finally {
      setBackfillingId(null);
    }
  }

  // 백필에서 CMS 504로 건너뛴 달을 한 달씩 다시 수집(엑셀 대체 경로 포함). 한 달이 약 1분 걸립니다.
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  async function runRetrySkipped(b: ReportBrand) {
    setRetryingId(b.id);
    setRetryResult(null);
    try {
      const r = await authedFetch(`/api/brands/${b.id}/backfill/retry-skipped`, { method: "POST" });
      const left = r.remainingSkippedMonths?.length ?? 0;
      if (!r.yearMonth) {
        setRetryResult({ id: b.id, ok: true, message: "다시 수집할 건너뛴 달이 없습니다." });
      } else if (r.ok) {
        setRetryResult({
          id: b.id,
          ok: true,
          message: `${r.yearMonth} 수집 완료${r.source === "EXCEL_FALLBACK" ? "(엑셀 다운로드 경로 — 서비스이용료 세부 내역 없음)" : ""}. ${
            left > 0 ? `아직 ${left}개월 남아 있어 버튼을 다시 눌러주세요.` : "건너뛴 달을 모두 채웠습니다."
          }`,
        });
      } else {
        setRetryResult({ id: b.id, ok: false, message: `${r.yearMonth} 재수집 실패 — ${r.message ?? "원인 불명"}` });
      }
      await load();
    } catch (e) {
      console.error("[BrandsPage] 건너뛴 달 재수집 실패:", e);
      setRetryResult({ id: b.id, ok: false, message: e instanceof Error ? e.message : "재수집에 실패했습니다." });
    } finally {
      setRetryingId(null);
    }
  }

  async function load() {
    if (!profile) return;
    try {
      setLoadError(null);
      // projects/page.tsx와 동일한 이유로 정렬은 클라이언트에서 처리합니다(where 단일 필드만 쓰면
      // 복합 색인이 필요 없어, 색인 배포 여부에 자동화 관리 화면이 좌우되지 않습니다).
      const snap = await getDocs(query(collection(db, "brands"), where("organization_id", "==", profile.organization_id)));
      const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ReportBrand));
      loaded.sort((a, b) => b.created_at - a.created_at);
      setBrands(loaded);
    } catch (error) {
      console.error("[BrandsPage] 브랜드 목록 조회 실패:", error);
      setLoadError("브랜드 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // 삭제 = 비활성화(soft-delete): 이 브랜드를 참조하는 리포트 발행 이력이 있을 수 있으므로
  // 문서를 실제로 지우지 않고 brand_status만 바꿉니다(회사/부서/사용자 삭제와 동일한 원칙).
  async function setStatus(b: ReportBrand, status: "ACTIVE" | "INACTIVE") {
    try {
      await updateDoc(doc(db, "brands", b.id), { brand_status: status, updated_at: Date.now() });
      setConfirmToggleId(null);
      await load();
    } catch (error) {
      console.error("[BrandsPage] 브랜드 상태 변경 실패:", error);
      alert("처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  function canEdit(b: ReportBrand) {
    return !!profile && (profile.org_role === "SUPER_ADMIN" || profile.id === b.created_by);
  }

  const activeBrands = brands.filter((b) => b.brand_status !== "INACTIVE");
  const inactiveBrands = brands.filter((b) => b.brand_status === "INACTIVE");

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-navy">브랜드 관리</h1>
          <button className="btn btn-primary" onClick={() => setModalMode("create")}>
            + 브랜드 추가
          </button>
        </div>

        {loadError && <p className="card mb-4 p-4 text-sm text-red-600">{loadError}</p>}

        <div className="flex flex-col gap-2">
          {activeBrands.map((b) => (
            <div key={b.id} className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{b.brand_name}</span>
                  <span className="text-xs text-gray-400">{b.company_name}</span>
                  {b.phone_verification_required && (
                    <span className="badge bg-amber-100 text-amber-800">2차 인증(전화번호)</span>
                  )}
                  {b.has_saved_credentials ? (
                    <span className="badge bg-emerald-100 text-emerald-800">계정 저장됨</span>
                  ) : (
                    <span className="badge bg-gray-100 text-gray-500">계정 미등록</span>
                  )}
                  {b.backfill_status && b.backfill_status !== "COMPLETED" && (
                    <span className="badge bg-blue-100 text-blue-800">
                      백필 {b.backfill_status === "PENDING" ? "대기" : b.backfill_status === "IN_PROGRESS" ? "진행 중" : "실패"}
                      {b.backfill_completed_through && ` (${b.backfill_completed_through}까지 완료)`}
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-gray-400">{b.cms_url}</div>
                <div className="text-xs text-gray-400">
                  담당자: {b.manager_name}
                  {b.service_open_date && ` · 서비스 오픈일: ${b.service_open_date}`}
                </div>
                {b.backfill_skipped_months && b.backfill_skipped_months.length > 0 && (
                  // CMS 서버 자체의 게이트웨이 타임아웃(504)으로 재시도해도 해결되지 않아 건너뛴 달 —
                  // backfill.ts의 GATEWAY_TIMEOUT 처리 참고. 데이터가 비어 있는 달이니 담당자가
                  // CMS 쪽과 별도로 확인/재수집할 수 있도록 계속 보이게 둡니다.
                  <p className="mt-1 text-xs text-amber-700">
                    CMS 응답 지연으로 건너뛴 달(데이터 없음): {b.backfill_skipped_months.join(", ")}
                  </p>
                )}
                {collectResult && collectResult.id === b.id && (
                  <p className={`mt-1 break-all text-xs ${collectResult.ok ? "text-emerald-700" : "text-red-600"}`}>
                    {collectResult.message}
                  </p>
                )}
                {retryResult && retryResult.id === b.id && (
                  <p className={`mt-1 break-all text-xs ${retryResult.ok ? "text-emerald-700" : "text-red-600"}`}>
                    {retryResult.message}
                  </p>
                )}
                {backfillResult && backfillResult.id === b.id && (
                  <p className={`mt-1 break-all text-xs ${backfillResult.ok ? "text-emerald-700" : "text-red-600"}`}>
                    {backfillResult.message}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {b.has_saved_credentials && b.service_open_date && b.backfill_status && b.backfill_status !== "COMPLETED" && (
                  <button
                    className="btn btn-secondary text-xs"
                    disabled={backfillingId === b.id}
                    onClick={() => runBackfill(b)}
                  >
                    {backfillingId === b.id
                      ? "백필 중..."
                      : b.backfill_completed_through
                        ? "백필 이어하기"
                        : "백필 시작"}
                  </button>
                )}
                {b.has_saved_credentials && b.backfill_skipped_months && b.backfill_skipped_months.length > 0 && (
                  <button
                    className="btn btn-secondary text-xs"
                    disabled={retryingId === b.id}
                    onClick={() => runRetrySkipped(b)}
                  >
                    {retryingId === b.id ? "재수집 중(약 1분)..." : `건너뛴 달 다시 수집 (${b.backfill_skipped_months.length})`}
                  </button>
                )}
                {b.has_saved_credentials && (
                  <button
                    className="btn btn-secondary text-xs"
                    disabled={collectingId === b.id}
                    onClick={() => runCollect(b)}
                  >
                    {collectingId === b.id ? "수집 중..." : "지금 수집(테스트)"}
                  </button>
                )}
                {canEdit(b) ? (
                  <>
                    <button className="btn btn-secondary text-xs" onClick={() => setModalMode(b)}>
                      수정
                    </button>
                    {confirmToggleId === b.id ? (
                      <span className="flex items-center gap-1 text-xs">
                        정말 삭제할까요?
                        <button className="btn btn-accent text-xs" onClick={() => setStatus(b, "INACTIVE")}>
                          예
                        </button>
                        <button className="btn btn-secondary text-xs" onClick={() => setConfirmToggleId(null)}>
                          아니오
                        </button>
                      </span>
                    ) : (
                      <button className="btn btn-secondary text-xs" onClick={() => setConfirmToggleId(b.id)}>
                        삭제
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-gray-400">담당자만 수정 가능</span>
                )}
              </div>
            </div>
          ))}
          {!loadError && activeBrands.length === 0 && (
            <p className="card p-6 text-center text-sm text-gray-400">등록된 브랜드가 없습니다.</p>
          )}
        </div>

        {inactiveBrands.length > 0 && (
          <div className="mt-6">
            <button className="text-xs text-gray-400 underline" onClick={() => setShowInactive((v) => !v)}>
              비활성 브랜드 {inactiveBrands.length}개 {showInactive ? "숨기기" : "보기"}
            </button>
            {showInactive && (
              <div className="mt-2 flex flex-col gap-2">
                {inactiveBrands.map((b) => (
                  <div key={b.id} className="card flex items-center justify-between gap-3 p-4 opacity-60">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink">{b.brand_name}</div>
                      <div className="truncate text-sm text-gray-400">
                        {b.company_name} · {b.cms_url}
                      </div>
                    </div>
                    {canEdit(b) && (
                      <button className="btn btn-secondary shrink-0 text-xs" onClick={() => setStatus(b, "ACTIVE")}>
                        복원
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {modalMode && (
          <BrandModal
            brand={modalMode === "create" ? null : modalMode}
            onClose={() => setModalMode(null)}
            onDone={async () => {
              setModalMode(null);
              await load();
            }}
          />
        )}
      </main>
    </div>
  );
}

function BrandModal({
  brand,
  onClose,
  onDone,
}: {
  brand: ReportBrand | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { profile } = useAuth();
  const [companyName, setCompanyName] = useState(brand?.company_name ?? "");
  const [brandName, setBrandName] = useState(brand?.brand_name ?? "");
  const [cmsUrl, setCmsUrl] = useState(brand?.cms_url ?? "");
  const [managerName, setManagerName] = useState(brand?.manager_name ?? profile?.user_name ?? "");
  const [phoneVerification, setPhoneVerification] = useState(brand?.phone_verification_required ?? false);
  const [serviceOpenDate, setServiceOpenDate] = useState(brand?.service_open_date ?? "");
  // 그로스잇 수수료 기본값(%) — 화면④ 수수료 입력란에 미리 채워지는 값(빈칸 = 미입력).
  const [feeDeliveryRate, setFeeDeliveryRate] = useState(brand?.fee_defaults?.delivery_rate?.toString() ?? "");
  const [feePickupRate, setFeePickupRate] = useState(brand?.fee_defaults?.pickup_rate?.toString() ?? "");
  const [feeBenchmarkRate, setFeeBenchmarkRate] = useState(brand?.fee_defaults?.benchmark_rate?.toString() ?? "");
  const [cmsUsername, setCmsUsername] = useState("");
  const [cmsPassword, setCmsPassword] = useState("");
  const [fixedVerificationCode, setFixedVerificationCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreate = !brand;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !companyName.trim() || !brandName.trim() || !cmsUrl.trim() || !managerName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        company_name: companyName.trim(),
        brand_name: brandName.trim(),
        cms_url: cmsUrl.trim(),
        manager_name: managerName.trim(),
        phone_verification_required: phoneVerification,
        service_open_date: serviceOpenDate.trim() || null,
        // 수정 화면에서 비워두면 기존 저장된 계정 정보를 그대로 유지합니다(재입력 강제 안 함).
        cms_username: cmsUsername.trim() || null,
        cms_password: cmsPassword || null,
        fixed_verification_code: fixedVerificationCode.trim() || null,
        // 빈칸 → null(미입력), 숫자가 아니면 서버 검증에서 막힙니다.
        fee_delivery_rate: feeDeliveryRate.trim() === "" ? null : Number(feeDeliveryRate),
        fee_pickup_rate: feePickupRate.trim() === "" ? null : Number(feePickupRate),
        fee_benchmark_rate: feeBenchmarkRate.trim() === "" ? null : Number(feeBenchmarkRate),
      };
      if (isCreate) {
        const created = await authedFetch("/api/brands", { method: "POST", body: JSON.stringify(payload) });
        if (payload.service_open_date && payload.cms_username && payload.cms_password) {
          // 첫 백필 실행은 응답을 기다리지 않고 백그라운드로 던져둡니다(최대 60초까지 걸릴 수 있어
          // 모달을 막지 않기 위함) — 실패하거나 다 못 끝내도 브랜드 관리 화면의 "백필 이어하기"
          // 버튼으로 다시 실행할 수 있으므로 여기서는 실패를 사용자에게 보여주지 않습니다.
          authedFetch(`/api/brands/${created.id}/backfill`, { method: "POST" }).catch((e) => {
            console.error("[BrandModal] 백필 자동 실행 실패(브랜드 관리 화면에서 이어하기 가능):", e);
          });
        }
      } else {
        await authedFetch("/api/brands", { method: "PATCH", body: JSON.stringify({ id: brand.id, ...payload }) });
      }
      onDone();
    } catch (e) {
      console.error("[BrandModal] 브랜드 저장 실패:", e);
      setError(e instanceof Error ? e.message : "저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-sm p-6">
        <h3 className="mb-4 font-semibold text-ink">{isCreate ? "브랜드 추가" : "브랜드 수정"}</h3>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">회사명</label>
            <input className="input w-full" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">브랜드명</label>
            <input className="input w-full" value={brandName} onChange={(e) => setBrandName(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">CMS 사이트 URL</label>
            <input
              className="input w-full"
              type="url"
              placeholder="https://example-cms.woori-it.co.kr/"
              value={cmsUrl}
              onChange={(e) => setCmsUrl(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">담당자명</label>
            <input className="input w-full" value={managerName} onChange={(e) => setManagerName(e.target.value)} required />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={phoneVerification}
              onChange={(e) => setPhoneVerification(e.target.checked)}
            />
            로그인 시 전화번호 인증(2차 인증) 단계가 있음 — 예: 브레댄코
          </label>
          {phoneVerification && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                고정 인증번호 {!isCreate && brand?.has_saved_credentials ? "(변경 시에만 입력)" : ""}
              </label>
              <input
                className="input w-full"
                placeholder={
                  !isCreate && brand?.has_saved_credentials ? "저장된 인증번호 유지" : "실제 SMS 없이 항상 동일하게 쓰는 인증번호"
                }
                value={fixedVerificationCode}
                onChange={(e) => setFixedVerificationCode(e.target.value)}
                autoComplete="off"
              />
              <p className="mt-1 text-[11px] text-gray-400">
                CMS 계정과 마찬가지로 암호화해 저장하고, 자동 로그인 시 전화번호 인증 단계에 자동으로 입력됩니다.
              </p>
            </div>
          )}

          <hr className="my-1 border-gray-100" />

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">서비스 오픈일 (선택)</label>
            <input
              className="input w-full"
              type="date"
              value={serviceOpenDate}
              onChange={(e) => setServiceOpenDate(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              입력하면 등록 직후 이 날짜부터 전월까지의 과거 데이터를 CMS에서 한 번에 가져와 반영합니다(백필).
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">그로스잇 수수료 기본값 (%, 선택)</label>
            <div className="flex gap-2">
              <input
                className="input w-full"
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="배달 수수료율"
                value={feeDeliveryRate}
                onChange={(e) => setFeeDeliveryRate(e.target.value)}
              />
              <input
                className="input w-full"
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="픽업 수수료율"
                value={feePickupRate}
                onChange={(e) => setFeePickupRate(e.target.value)}
              />
            </div>
            <input
              className="input mt-2 w-full"
              type="number"
              min={0}
              max={100}
              step="0.01"
              placeholder="배달앱 벤치마크 (비우면 업계 평균 10.8%)"
              value={feeBenchmarkRate}
              onChange={(e) => setFeeBenchmarkRate(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              리포트 발행 화면④의 채널 효율 비교(수수료 절감액)에 미리 채워지는 값이며, 발행할 때 그 달에만 바꿀 수도 있습니다.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              CMS 계정 {isCreate ? "(선택 — 나중에 발행 화면에서도 등록 가능)" : "(변경 시에만 입력)"}
            </label>
            <div className="flex gap-2">
              <input
                className="input w-full"
                placeholder={!isCreate && brand?.has_saved_credentials ? "저장된 아이디 유지" : "CMS 로그인 아이디"}
                value={cmsUsername}
                onChange={(e) => setCmsUsername(e.target.value)}
                autoComplete="off"
              />
              <input
                className="input w-full"
                type="password"
                placeholder={!isCreate && brand?.has_saved_credentials ? "저장된 비밀번호 유지" : "CMS 로그인 비밀번호"}
                value={cmsPassword}
                onChange={(e) => setCmsPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <p className="mt-1 text-[11px] text-gray-400">
              매월 재입력하지 않도록 암호화해 저장하고, Monthly Report 발행 시 자동으로 채워집니다.
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              취소
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function BrandsPage() {
  return (
    <AuthGate>
      <BrandsContent />
    </AuthGate>
  );
}
