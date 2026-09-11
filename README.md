# 그로스잇 회의록 시스템

AI 회의 연속성·질의·지식관리 시스템 기획서 v1.0을 기반으로 만든, 실제로 운영 중인 웹앱입니다.
회의록을 텍스트/AI로 채록·추출하는 대신 **구조화된 화면에 직접 입력**하며, 질의(Q&A)·결정사항·향후추진과제를
회의마다 쌓아 다음 회의로 이어지는 조직 업무 기억을 관리합니다.

> 기획서 대비 가장 큰 설계 변경 (진행 과정에서 확정)
> - AI 자동분석(Claude 연동) 기능은 완전히 제거했습니다. 요약·질의·결정·액션아이템은 전부 화면에서 직접 입력합니다.
> - Cloud Functions(알림 자동발송, 기한초과 자동처리)를 쓰지 않고 Firebase **Spark(무료) 요금제**만으로 운영합니다.
>   알림은 개별 저장 없이, 접속 시 "지난 방문 이후 업데이트"를 계산해서 보여주는 방식으로 대체했습니다.
> - 외부 공유 링크는 로그인 없이 공유 전용 뷰(`/share/[token]/view`) 하나만 보여주고, 앱의 다른 화면으로는
>   이동할 수 없습니다(서명된 접속 토큰 + 서버 전용 콘텐츠 API 기반).

---

## 0. 전체 그림

```
GitHub 저장소 (이 코드)
        │
        └── Vercel 배포 ── Next.js 앱 (화면 + API 라우트, Admin SDK로 관리 기능 처리)
                 │
                 └── Firebase 프로젝트 (growthit-meetings)
                          ├── Authentication (이메일/비밀번호 로그인)
                          └── Firestore (회사/부서/사용자/프로젝트/회의/질의/결정/향후추진과제 등)
```

Cloud Functions는 사용하지 않습니다. 관리 기능(회사·부서·사용자 생성/수정/삭제, 공유 접속 로그 조회 등)과
로그인 직후 프로필 조회는 클라이언트 Firestore가 아니라 서버 API 라우트(Firebase Admin SDK)를 거칩니다 —
사내 네트워크에 따라 Firestore의 실시간 연결(WebChannel)이 불안정한 경우가 있어, 이 경로들만큼은
일반 HTTPS 요청으로 처리해 속도와 안정성을 확보했습니다.

---

## 1. 사전 준비물

| 항목 | 용도 | 준비 방법 |
|---|---|---|
| GitHub 계정 | 코드 저장소 | 이미 있다고 가정 |
| Firebase 프로젝트 | DB·인증 | [Firebase 콘솔](https://console.firebase.google.com)에서 이미 만든 프로젝트(growthit-meetings) 사용 |
| Node.js 20 이상 | 로컬 개발 | [nodejs.org](https://nodejs.org)에서 설치 |
| Vercel 계정 | 앱 호스팅 | [vercel.com](https://vercel.com) — GitHub 계정으로 가입 가능, GitHub 연동 시 main 브랜치 push마다 자동 배포됩니다 |

Anthropic API 키는 더 이상 필요하지 않습니다(AI 분석 기능 제거).

---

## 2. GitHub에 코드 반영하기

이 저장소에 파일을 추가/수정할 때는 **"Add file → Upload files"로 폴더째 드래그 업로드하지 않습니다.**
과거 이 방식으로 하위 폴더 구조가 깨지고(파일이 엉뚱한 경로에 들어가거나 동명 파일이 `page (1).tsx`로
리네임됨) 실제 라이브 파일이 잘못 덮어써진 적이 있습니다. 대신 GitHub 웹에서 기존 파일을 열어 직접
수정하거나, "Add file → Create new file"에 **전체 경로를 그대로 타이핑**해서 만드는 방식을 씁니다.

```bash
cd meeting-knowledge-system
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-org>/<repo-name>.git
git branch -M main
git push -u origin main
```

> `.env.local` 등 비밀값이 담긴 파일은 `.gitignore`에 이미 등록되어 있어 실수로 커밋되지 않습니다.
> 커밋 전에 `git status`로 한 번 확인하는 걸 권장합니다.

---

## 3. Firebase 프로젝트 연결

### 3-1. Firestore Database 활성화
Firebase 콘솔 → 프로젝트 선택 → **Firestore Database** → "데이터베이스 만들기" → 프로덕션 모드 → 리전 선택(예: `asia-northeast3` 서울).

### 3-2. Authentication 활성화
Firebase 콘솔 → **Authentication** → "시작하기" → 로그인 방법 탭 → **이메일/비밀번호** 사용 설정.

### 3-3. 보안 규칙 게시
Firebase 콘솔 → Firestore Database → **규칙** 탭에 이 저장소의 `firestore.rules` 내용을 그대로 붙여넣고 게시합니다.

> `organizations`/`departments`/`users`/`projects`의 목록(list/쿼리) 조회 규칙은 커스텀 함수를 여러 단계
> 거쳐 `get()`을 호출하면 "Missing or insufficient permissions"로 실패하는 Firestore 규칙 엔진의 특성 때문에,
> 규칙 안에서 `get()`을 직접 인라인으로 호출해 비교하는 방식으로 작성되어 있습니다(`organizations`는
> 민감정보가 없어 로그인 사용자 전체 공개). 규칙을 다시 손볼 때는 이 특성을 참고하세요.

### 3-4. 색인 생성
`firestore.indexes.json`에 정의된 복합 색인을 콘솔의 **색인** 탭에서 생성합니다. 놓친 조합이 있으면
실제 사용 중 브라우저 콘솔에 뜨는 "인덱스를 만드세요" 링크를 클릭하면 자동으로 채워집니다.

### 3-5. 클라이언트 설정값 확인 (공개 가능한 값)
Firebase 콘솔 → 프로젝트 설정(⚙️) → 일반 탭 → 하단 "내 앱" → 웹 앱이 없다면 `</>` 아이콘으로 하나 추가 →
표시되는 `firebaseConfig` 값을 복사해둡니다.

### 3-6. 서비스 계정 키 발급 (절대 공개 금지)
Firebase 콘솔 → 프로젝트 설정 → **서비스 계정** 탭 → "새 비공개 키 생성" → JSON 파일 다운로드.
이 파일 안의 `project_id`, `client_email`, `private_key` 값을 곧 환경변수에 옮겨 적습니다.
`private_key`는 줄바꿈이 포함된 긴 문자열이라 복사 과정에서 따옴표/개행이 깨지기 쉬우니, Vercel 등에
붙여넣은 뒤 재배포가 500 에러를 내면 이 값부터 의심하고 재발급하는 것이 빠릅니다.

---

## 4. 로컬 환경 설정

```bash
npm install
cp .env.example .env.local
```

`.env.local`을 열어 아래 값을 채웁니다.

- `NEXT_PUBLIC_FIREBASE_*` (6개) — 3-5에서 복사한 `firebaseConfig` 값 그대로. 클라이언트 번들에 포함되는
  공개 값이라 민감정보는 아니지만, Vercel에는 **Production/Preview 양쪽 모두** 등록되어 있어야
  브랜치 배포(Preview)에서도 로그인이 정상 동작합니다.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — 3-6에서 받은 JSON의
  `project_id`, `client_email`, `private_key` (Admin SDK 전용, 서버에서만 쓰이고 클라이언트에 노출되지
  않습니다 — 관리 기능 API와 로그인 직후 프로필 조회가 이 값을 사용합니다)

---

## 5. 최초 회사·관리자 계정 만들기

이 시스템은 자체 회원가입이 없습니다 — 슈퍼 관리자가 이메일로 계정을 발급하는 방식입니다.
그런데 "관리자를 만들 관리자"가 없으니, 맨 처음 1명은 아래 두 방법 중 하나로 직접 만듭니다.

**방법 A — 스크립트 (로컬에 Admin SDK 환경변수가 준비된 경우)**

```bash
npm run seed
```

회사명, 부서명, 관리자 이름/이메일/초기 비밀번호를 순서대로 입력하면 끝입니다.

**방법 B — Firebase 콘솔에서 수동 생성**

Authentication에서 이메일/비밀번호로 사용자를 만들고, Firestore의 `organizations`/`departments`/`users`
컬렉션에 각각 문서를 하나씩 직접 추가합니다. `users` 문서의 id는 **Authentication에서 발급된 UID와
반드시 동일**해야 합니다(다르면 로그인 직후 프로필 조회가 404로 실패합니다). `org_role`은
`"SUPER_ADMIN"`, `user_status`는 `"ACTIVE"`로 둡니다.

이후부터는 이 계정으로 로그인해서 `/admin` 화면에서 나머지 회사·부서·사용자를 등록/수정/삭제하면 됩니다.

---

## 6. 로컬에서 확인

```bash
npm run dev
```

`http://localhost:3000/login` 에서 5번에서 만든 계정으로 로그인 → 프로젝트 생성 → 회의 생성까지
한 번 직접 실행해보는 것을 권장합니다.

---

## 7. Vercel에 배포

1. [vercel.com](https://vercel.com) 로그인 → "Add New... → Project" → 2번에서 올린 GitHub 저장소 선택
2. Environment Variables에 `.env.local`에 채운 값 9개(공개 6개 + Admin SDK 3개)를 등록 —
   **Production과 Preview 둘 다 체크**해야 합니다(하나만 체크하면 다른 배포 환경에서 500 에러가 납니다)
3. Deploy 클릭 (main 브랜치에 push할 때마다 자동 재배포됩니다)

---

## 8. 사용 흐름 요약

```
슈퍼 관리자 로그인 → /admin에서 회사·부서·사용자 등록 (초기 비밀번호 123456, 최초 로그인 시 변경 필수)
     ↓
/projects에서 프로젝트 생성
     ↓
/meetings/new 에서 회의 생성 (개요 → 요약 → 논의내용 → 향후추진과제 구조화 입력)
     ↓
회의 상세 화면에서 참여자 지정(편집자만 가능) · 질의응답(Q&A) 스레드 작성 · 결정사항 등록/변경(이력 자동 기록)
     ↓
메인 대시보드에서 통합검색(AND 조건) · 담당자별 향후추진과제 확인 · 지난 방문 이후 업데이트 확인
     ↓
필요 시 회의별로 외부 공유 링크 발급(이메일+임시 비밀번호, 열람자는 그 회의 1건만 볼 수 있는 별도 화면으로 접속)
```

---

## 9. 지금은 빠져 있는 것

- **자연어 AI 검색** (기획서 30장) — 현재는 회사/참석자/제목/날짜 등 AND 조건 검색만 지원합니다. AI 분석
  기능 자체를 제거하기로 하면서 함께 보류된 항목입니다.
- **이메일·SMS·Slack·Teams·카카오워크 알림** (기획서 20장) — 현재는 접속 시 "지난 방문 이후 업데이트"만
  화면에 표시됩니다. 계정 생성/비밀번호 리셋 시 초기 비밀번호도 이메일 자동 발송 없이 관리자가 화면에
  뜨는 값을 직접 전달해야 합니다.
- **파트너사(타 회사) 사용자를 위한 별도 가입/초대 흐름** — 외부 인원은 회의별 공유 링크(열람자)로만
  접근하며, 시스템 계정 자체를 파트너사가 스스로 만들 방법은 없습니다(의도적으로 범위에서 제외).
- **Firestore 데이터 정리 자동화** — 회사/부서/사용자/프로젝트 삭제는 전부 소프트 삭제(비활성화·보관)이며,
  실제 문서를 지우거나 중복 데이터를 정리하는 기능은 없습니다(운영자가 Firebase 콘솔에서 직접 처리).

관리 화면의 회사·부서 수정/삭제, 프로젝트 수정/삭제(보관)는 모두 구현되어 있습니다(회사·부서·사용자 삭제는
전부 소프트 삭제 방식이라 연결된 회의·질의·결정 등 기존 데이터에는 영향이 없습니다).

---

## 10. 폴더 구조

```
src/lib/types.ts                     기획서 엔터티 전체를 옮긴 타입 정의
firestore.rules                      회의 권한(AUTHOR/PARTICIPANT/VIEWER) + 조직/부서/사용자/프로젝트 조회 규칙
firestore.indexes.json               복합 색인 정의
src/lib/firebase/client.ts           클라이언트 Firestore/Auth 초기화 (long-polling 강제)
src/lib/firebase/admin.ts            서버 전용 Firebase Admin SDK 초기화 (API 라우트에서만 사용)
src/lib/firebase/meetingAccess.ts    meetings/{id}/permissions 서브컬렉션 + member_uids 비정규화 필드를 함께 갱신하는 헬퍼
src/lib/adminAuthCheck.ts            API 라우트 공용 인증/권한 검사 (requireUser / requireSuperAdmin / requireMeetingRole)
src/app/admin/                       관리자 화면 (회사/부서/사용자/공유 접속 로그)
src/app/api/admin/                   회사·부서·사용자 생성/수정/삭제 API (Admin SDK)
src/app/projects/                    프로젝트 생성/수정/보관(삭제)
src/app/meetings/new/                회의 생성 (구조화 입력)
src/app/meetings/[id]/               회의 상세 (참여자·Q&A·결정사항·향후추진과제·회의 간 연결)
src/app/qna/                         전사 Q&A 관리 화면 (ADMIN 이상)
src/app/share/[token]/               외부 공유 접속 화면 + 공유 전용 뷰
scripts/seed.ts                      최초 회사/관리자 계정 부트스트랩 스크립트
```
