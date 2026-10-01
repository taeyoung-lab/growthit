"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { Navbar } from "@/components/Navbar";
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
                </div>
                <div className="truncate text-sm text-gray-400">{b.cms_url}</div>
                <div className="text-xs text-gray-400">담당자: {b.manager_name}</div>
              </div>
              <div className="flex shrink-0 gap-2">
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreate = !brand;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !companyName.trim() || !brandName.trim() || !cmsUrl.trim() || !managerName.trim()) return;
    setSubmitting(true);
    setError(null);
    const now = Date.now();
    try {
      if (isCreate) {
        await addDoc(collection(db, "brands"), {
          organization_id: profile.organization_id,
          company_name: companyName.trim(),
          brand_name: brandName.trim(),
          cms_url: cmsUrl.trim(),
          manager_name: managerName.trim(),
          created_by: profile.id,
          phone_verification_required: phoneVerification,
          brand_status: "ACTIVE",
          created_at: now,
          updated_at: now,
        });
      } else {
        await updateDoc(doc(db, "brands", brand.id), {
          company_name: companyName.trim(),
          brand_name: brandName.trim(),
          cms_url: cmsUrl.trim(),
          manager_name: managerName.trim(),
          phone_verification_required: phoneVerification,
          updated_at: now,
        });
      }
      onDone();
    } catch (e) {
      console.error("[BrandModal] 브랜드 저장 실패:", e);
      setError("저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
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

