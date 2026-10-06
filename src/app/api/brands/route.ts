import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireUser, ApiAuthError } from "@/lib/adminAuthCheck";
import { encryptCmsPassword } from "@/lib/cmsCredentials";
import type { ReportBrand, BrandCredentials, BrandFeeDefaults } from "@/lib/types";

// 그로스잇 브랜드 정기 성과 리포트 자동화 — 브랜드 생성/수정 전용 API.
// src/app/brands/page.tsx(브랜드명·CMS URL 등 비밀 아닌 필드)는 기존처럼 클라이언트 Firestore SDK로
// 직접 읽고 쓰지만, CMS 로그인 자격증명이 함께 들어가는 생성/수정만큼은 반드시 이 라우트를 거칩니다
// — 비밀번호를 서버(firebase-admin)에서만 암호화해 brandCredentials 컬렉션에 쓰기 위함입니다
// (그 컬렉션은 firestore.rules가 클라이언트 read/write를 전면 차단).
//
// 2026-10-01 기준: 생성 시 service_open_date가 있으면 backfill_status를 PENDING으로 표시만 해둡니다.
// 실제 CMS 자동 로그인·데이터 수집(백필 포함) 로직은 아직 구현되지 않았습니다 — 브랜드별 CMS 로그인
// 폼의 실제 선택자(selector) 확인이 먼저 필요합니다(진행 중, 담당자 확인 대기).

interface BrandRequestBody {
  company_name: string;
  brand_name: string;
  cms_url: string;
  manager_name: string;
  phone_verification_required: boolean;
  service_open_date: string | null; // YYYY-MM-DD, 선택
  cms_username: string | null; // 비워두면(수정 시) 기존 저장값 유지
  cms_password: string | null; // 비워두면(수정 시) 기존 저장값 유지 — 평문으로 받아 이 라우트에서만 암호화
  // 브레댄코처럼 phone_verification_required=true인 브랜드만 사용(고정 인증번호). 평문으로 받아
  // cms_password와 동일하게 이 라우트에서만 암호화합니다. 비워두면(수정 시) 기존 저장값 유지.
  fixed_verification_code: string | null;
  // 그로스잇 수수료 기본값(%) — 2026-10-05 추가(화면④ 수수료 키인 기본값). 필드를 아예 보내지 않으면
  // (수정 시) 기존 저장값을 유지하고, null을 보내면 "미입력"으로 비웁니다.
  fee_delivery_rate?: number | null;
  fee_pickup_rate?: number | null;
  fee_benchmark_rate?: number | null;
}

function isValidRate(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100);
}

// 수수료율 3개 중 하나라도 보낸 경우에만 기본값 객체를 만들어 돌려줍니다(안 보낸 필드는 existing 값 유지).
function buildFeeDefaults(body: Partial<BrandRequestBody>, existing?: BrandFeeDefaults): BrandFeeDefaults | undefined {
  const touched =
    body.fee_delivery_rate !== undefined || body.fee_pickup_rate !== undefined || body.fee_benchmark_rate !== undefined;
  if (!touched) return existing;
  return {
    delivery_rate: body.fee_delivery_rate !== undefined ? body.fee_delivery_rate : (existing?.delivery_rate ?? null),
    pickup_rate: body.fee_pickup_rate !== undefined ? body.fee_pickup_rate : (existing?.pickup_rate ?? null),
    benchmark_rate: body.fee_benchmark_rate !== undefined ? body.fee_benchmark_rate : (existing?.benchmark_rate ?? null),
  };
}

function validate(body: Partial<BrandRequestBody>): string | null {
  if (!body.company_name?.trim()) return "회사명은 필수입니다.";
  if (!body.brand_name?.trim()) return "브랜드명은 필수입니다.";
  if (!body.cms_url?.trim()) return "CMS 사이트 URL은 필수입니다.";
  if (!body.manager_name?.trim()) return "담당자명은 필수입니다.";
  if (body.service_open_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.service_open_date)) {
    return "서비스 오픈일 형식이 올바르지 않습니다(YYYY-MM-DD).";
  }
  if ((body.cms_username && !body.cms_password) || (!body.cms_username && body.cms_password)) {
    return "CMS 아이디와 비밀번호는 함께 입력해주세요.";
  }
  if (!isValidRate(body.fee_delivery_rate) || !isValidRate(body.fee_pickup_rate) || !isValidRate(body.fee_benchmark_rate)) {
    return "수수료율은 0~100 사이 숫자(%)로 입력해주세요.";
  }
  return null;
}

// 전화번호 인증이 필요한 브랜드인데 (신규 등록이고) 고정 인증번호가 비어 있으면 자동 로그인이
// 끝까지 진행되지 못하므로, 생성 시에는 여기서 막습니다(수정 시에는 기존 저장값을 유지할 수 있어
// 이 체크를 적용하지 않음 — 아래 PATCH 핸들러 참고).
function validateNewPhoneVerification(body: Partial<BrandRequestBody>): string | null {
  if (body.phone_verification_required && body.cms_username && !body.fixed_verification_code?.trim()) {
    return "전화번호 인증이 필요한 브랜드는 고정 인증번호도 함께 입력해주세요.";
  }
  return null;
}

// 신규 등록 시 그로스잇 수수료율(배달·픽업)은 필수 — 브랜드마다 계약 조건이 달라 리포트의 수수료 절감액
// 계산에 꼭 필요합니다. 수수료가 없으면 0을 입력합니다. (수정 시에는 기존 브랜드 호환을 위해 선택 입력)
function validateNewFeeRates(body: Partial<BrandRequestBody>): string | null {
  const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!ok(body.fee_delivery_rate) || !ok(body.fee_pickup_rate)) {
    return "그로스잇 배달·픽업 수수료율은 필수입니다(수수료가 없으면 0을 입력해주세요).";
  }
  return null;
}

// 생성: 로그인한 사용자 누구나(등록자 = 담당자, firestore.rules의 /brands create 규칙과 동일 원칙).
export async function POST(req: NextRequest) {
  try {
    const { uid, profile } = await requireUser(req);
    const body = (await req.json()) as Partial<BrandRequestBody>;
    const invalid = validate(body) ?? validateNewPhoneVerification(body) ?? validateNewFeeRates(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const now = Date.now();
    const db = getAdminDb();
    const brandRef = db.collection("brands").doc();

    const hasCredentials = !!(body.cms_username && body.cms_password);

    const brand: ReportBrand = {
      id: brandRef.id,
      organization_id: profile.organization_id,
      company_name: body.company_name!.trim(),
      brand_name: body.brand_name!.trim(),
      cms_url: body.cms_url!.trim(),
      manager_name: body.manager_name!.trim(),
      created_by: uid,
      phone_verification_required: !!body.phone_verification_required,
      has_saved_credentials: hasCredentials,
      service_open_date: body.service_open_date?.trim() || null,
      // 서비스 오픈일을 입력한 경우에만 백필 대상 — 실제 실행 로직은 아직 미구현이라 상태만 PENDING으로 표시.
      backfill_status: body.service_open_date?.trim() ? "PENDING" : null,
      backfill_completed_through: null,
      backfill_skipped_months: [],
      ...(buildFeeDefaults(body) ? { fee_defaults: buildFeeDefaults(body) } : {}),
      last_published_month: null,
      brand_status: "ACTIVE",
      created_at: now,
      updated_at: now,
    };

    const batch = db.batch();
    batch.set(brandRef, brand);
    if (hasCredentials) {
      const credentials: BrandCredentials = {
        brand_id: brandRef.id,
        cms_username: body.cms_username!.trim(),
        cms_password_encrypted: encryptCmsPassword(body.cms_password!),
        fixed_verification_code_encrypted: body.fixed_verification_code?.trim()
          ? encryptCmsPassword(body.fixed_verification_code.trim())
          : null,
        // 신규 등록 시점엔 아직 로그인해본 적이 없으니 캐시된 세션도 없습니다.
        cms_session_cookie_encrypted: null,
        cms_session_cached_at: null,
        updated_by: uid,
        updated_at: now,
      };
      batch.set(db.collection("brandCredentials").doc(brandRef.id), credentials);
    }
    await batch.commit();

    return NextResponse.json({ id: brandRef.id });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[POST /api/brands]", e);
    return NextResponse.json({ error: "브랜드 생성에 실패했습니다." }, { status: 500 });
  }
}

// 수정: 담당자 본인(created_by) 또는 SUPER_ADMIN만 — firestore.rules의 /brands update 규칙과 동일 원칙.
// cms_username/cms_password를 비워서 보내면 기존 저장된 계정 정보는 그대로 둡니다(재입력 강제 안 함).
export async function PATCH(req: NextRequest) {
  try {
    const { uid, profile } = await requireUser(req);
    const body = (await req.json()) as Partial<BrandRequestBody> & { id?: string };
    if (!body.id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    const invalid = validate(body);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const db = getAdminDb();
    const brandRef = db.collection("brands").doc(body.id);
    const snap = await brandRef.get();
    if (!snap.exists) return NextResponse.json({ error: "대상 브랜드를 찾을 수 없습니다." }, { status: 404 });
    const existing = snap.data() as ReportBrand;

    const canEdit = profile.org_role === "SUPER_ADMIN" || existing.created_by === uid;
    if (!canEdit) return NextResponse.json({ error: "이 브랜드를 수정할 권한이 없습니다." }, { status: 403 });

    const now = Date.now();
    const wantsCredentialChange = !!(body.cms_username && body.cms_password);

    const updates: Partial<ReportBrand> = {
      company_name: body.company_name!.trim(),
      brand_name: body.brand_name!.trim(),
      cms_url: body.cms_url!.trim(),
      manager_name: body.manager_name!.trim(),
      phone_verification_required: !!body.phone_verification_required,
      service_open_date: body.service_open_date?.trim() || null,
      updated_at: now,
    };
    if (wantsCredentialChange) updates.has_saved_credentials = true;
    const feeDefaults = buildFeeDefaults(body, existing.fee_defaults);
    if (feeDefaults) updates.fee_defaults = feeDefaults;
    // 서비스 오픈일을 기존에 없다가 이번에 처음 입력한 경우에만 백필 대상으로 새로 표시합니다
    // (이미 백필이 끝났거나 진행 중인 브랜드를 수정 한 번으로 재대상화하지 않도록).
    //
    // 2026-10-02: 여기에 더해 existing.backfill_status가 비어 있는 경우도 함께 구제합니다 —
    // backfill_status 필드가 생기기 전(2026-10-01 이전)에 만들어진 브랜드는 서비스 오픈일이 이미
    // 있었더라도 backfill_status가 한 번도 세팅되지 않아(null), 브랜드 관리 화면에 백필 버튼 자체가
    // 안 뜨는 문제가 있었습니다(영커피에서 확인). 그런 레거시 브랜드도 "수정 → 저장" 한 번이면
    // 자동으로 복구되도록 조건을 넓혔습니다.
    if (!existing.backfill_status && body.service_open_date?.trim()) {
      updates.backfill_status = "PENDING";
    }

    const batch = db.batch();
    batch.update(brandRef, updates);
    if (wantsCredentialChange) {
      // 고정 인증번호를 이번 요청에서 새로 보내지 않았다면(= 기존 계정 정보 그대로 재입력하는
      // 경우가 대부분) 기존 brandCredentials 문서의 값을 그대로 유지합니다 — 비밀번호만 바꾸면서
      // 전화번호 인증번호까지 매번 다시 입력하게 강제하지 않기 위함.
      let fixedVerificationCodeEncrypted: string | null = null;
      if (body.fixed_verification_code?.trim()) {
        fixedVerificationCodeEncrypted = encryptCmsPassword(body.fixed_verification_code.trim());
      } else {
        const existingCreds = await db.collection("brandCredentials").doc(body.id).get();
        fixedVerificationCodeEncrypted =
          (existingCreds.data() as BrandCredentials | undefined)?.fixed_verification_code_encrypted ?? null;
      }

      const credentials: BrandCredentials = {
        brand_id: body.id,
        cms_username: body.cms_username!.trim(),
        cms_password_encrypted: encryptCmsPassword(body.cms_password!),
        fixed_verification_code_encrypted: fixedVerificationCodeEncrypted,
        // 계정 정보가 바뀌는 경우(아이디/비밀번호 수정)이므로, 혹시 남아있던 캐시된 세션은
        // 무효화합니다 — 다음 백필 실행이 새 계정 정보로 다시 로그인하도록.
        cms_session_cookie_encrypted: null,
        cms_session_cached_at: null,
        updated_by: uid,
        updated_at: now,
      };
      batch.set(db.collection("brandCredentials").doc(body.id), credentials);
    }
    await batch.commit();

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[PATCH /api/brands]", e);
    return NextResponse.json({ error: "브랜드 수정에 실패했습니다." }, { status: 500 });
  }
}

