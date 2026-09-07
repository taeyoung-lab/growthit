# 회의 지식관리 시스템 (MVP)

AI 회의 연속성·질의·지식관리 시스템 기획서 v1.0을 기반으로 만든 실제 동작하는 웹앱입니다.
오디오/STT 대신 **텍스트로 회의록을 입력**하고, Claude API가 요약·질의·결정·액션아이템을 추출합니다.
DB/인증은 **Firebase(Firestore + Authentication)**, 배포는 **Vercel**, 알림/기한관리 자동화는
**Firebase Cloud Functions**를 사용합니다.

> 기획서와 다르게 구현한 부분 2가지 (검토 리포트 반영)
> 1. 공유 임시 비밀번호를 "wylie+회의일" 고정 규칙 대신, 공유 건마다 서버가 무작위 6자리 코드를 발급합니다.
> 2. 화자 인식은 자동 STT 대신 회의록 텍스트 입력 시 "이름: 발언" 형식으로 사람이 직접 화자를 표시합니다.

---

## 0. 전체 그림

```
GitHub 저장소 (이 코드)
        │
        ├── Vercel 배포 ── Next.js 앱 (화면 + API 라우트 + Claude 호출)
        │
        └── Firebase 프로젝트
                 ├── Authentication (이메일/비밀번호 로그인)
                 ├── Firestore (회사/부서/사용자/회의/질의/결정/업무 등 전체 데이터)
                 └── Cloud Functions (알림 자동 발송, 기한 초과 자동 처리)
```

Claude는 "AI 분석 엔진" 역할만 담당합니다 (요약/질의/결정/액션아이템 추출, 기존 질의 자동연결 제안).
호스팅·DB·인증은 Claude가 아니라 위 세 가지(GitHub+Vercel+Firebase)가 담당합니다.

---

## 1. 사전 준비물

| 항목 | 용도 | 준비 방법 |
|---|---|---|
| GitHub 계정 | 코드 저장소 | 이미 있다고 가정 |
| Firebase 프로젝트 | DB·인증·알림 자동화 | [Firebase 콘솔](https://console.firebase.google.com)에서 이미 만든 프로젝트 사용 |
| **Firebase Blaze 요금제** | Cloud Functions 사용 | Firebase 콘솔 좌측 하단 "업그레이드" → Blaze(종량제)로 전환. 소규모 내부 사용량은 대부분 무료 한도 내입니다 |
| Anthropic API 키 | AI 분석 | [console.anthropic.com](https://console.anthropic.com) → API Keys에서 발급 |
| Node.js 20 이상 | 로컬 개발/배포 준비 | [nodejs.org](https://nodejs.org)에서 설치 |
| Vercel 계정 | 앱 호스팅 (추천) | [vercel.com](https://vercel.com) — GitHub 계정으로 가입 가능 |

---

## 2. GitHub에 코드 올리기

전달받은 코드 폴더(`meeting-knowledge-system`)를 기준으로 진행합니다.

```bash
cd meeting-knowledge-system
git init
git add .
git commit -m "Initial commit: AI 회의 지식관리 시스템 MVP"
```

GitHub에서 새 저장소를 만듭니다 (github.com → New repository → 이름 입력 → **Initialize 옵션은 전부 체크 해제**하고 생성).
생성된 저장소 페이지에 나오는 안내를 그대로 따라 하면 됩니다:

```bash
git remote add origin https://github.com/<your-org>/<repo-name>.git
git branch -M main
git push -u origin main
```

> `.env.local`, `serviceAccountKey.json` 등 비밀값이 담긴 파일은 `.gitignore`에 이미 등록되어 있어
> 실수로 커밋되지 않습니다. 커밋 전에 `git status`로 한 번 확인하는 걸 권장합니다.

---

## 3. Firebase 프로젝트 연결

### 3-1. Firestore Database 활성화
Firebase 콘솔 → 프로젝트 선택 → **Firestore Database** → "데이터베이스 만들기" → 프로덕션 모드 → 리전 선택(예: `asia-northeast3` 서울).

### 3-2. Authentication 활성화
Firebase 콘솔 → **Authentication** → "시작하기" → 로그인 방법 탭 → **이메일/비밀번호** 사용 설정.

### 3-3. 클라이언트 설정값 확인 (공개 가능한 값)
Firebase 콘솔 → 프로젝트 설정(⚙️) → 일반 탭 → 하단 "내 앱" → 웹 앱이 없다면 `</>` 아이콘으로 하나 추가 →
표시되는 `firebaseConfig` 값을 복사해둡니다.

### 3-4. 서비스 계정 키 발급 (절대 공개 금지)
Firebase 콘솔 → 프로젝트 설정 → **서비스 계정** 탭 → "새 비공개 키 생성" → JSON 파일 다운로드.
이 파일 안의 `project_id`, `client_email`, `private_key` 값을 곧 `.env.local`에 옮겨 적습니다.

---

## 4. 로컬 환경 설정

```bash
npm install
cp .env.example .env.local
```

`.env.local`을 열어 아래 값을 채웁니다.

- `NEXT_PUBLIC_FIREBASE_*` — 3-3에서 복사한 `firebaseConfig` 값 그대로
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` — 3-4에서 받은 JSON의 `project_id`, `client_email`
- `FIREBASE_PRIVATE_KEY` — JSON의 `private_key` 값을 **큰따옴표로 감싸서** 그대로 붙여넣기 (줄바꿈이 `\n`으로 되어 있어도 코드에서 자동 변환합니다)
- `ANTHROPIC_API_KEY` — 1번에서 발급한 키
- `.firebaserc`의 `YOUR_FIREBASE_PROJECT_ID`도 실제 프로젝트 ID로 바꿔주세요

---

## 5. Firestore 보안규칙 · 인덱스 · Cloud Functions 배포

```bash
npm install -g firebase-tools   # 최초 1회만
firebase login
firebase deploy --only firestore:rules,firestore:indexes
```

Cloud Functions 배포 (알림 자동 발송 + 매일 자정 기한초과 처리):

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

> 인덱스는 처음 실제로 검색 기능을 써볼 때 브라우저 콘솔에 "인덱스를 만드세요"라는 링크가 뜰 수도 있습니다.
> `firestore.indexes.json`에 미리 정의해뒀지만, 혹시 놓친 조합이 있으면 그 링크를 클릭 한 번만 하면 됩니다.

---

## 6. 최초 회사·관리자 계정 만들기

이 시스템은 자체 회원가입이 없습니다(기획서 5장) — 관리자가 이메일로 계정을 발급하는 방식입니다.
그런데 "관리자를 만들 관리자"가 없으니, 맨 처음 1명은 스크립트로 직접 만듭니다.

```bash
npm run seed
```

회사명, 부서명, 관리자 이름/이메일/초기 비밀번호를 순서대로 입력하면 끝입니다.
이후부터는 이 계정으로 로그인해서 `/admin` 화면에서 나머지 부서·사용자를 등록하면 됩니다.

---

## 7. 로컬에서 확인

```bash
npm run dev
```

`http://localhost:3000/login` 에서 6번에서 만든 계정으로 로그인 → 프로젝트 생성 → 회의 생성 → 회의록 텍스트 입력 → AI 분석까지 한 번 직접 실행해보는 것을 권장합니다.

---

## 8. Vercel에 배포

1. [vercel.com](https://vercel.com) 로그인 → "Add New... → Project" → 2번에서 올린 GitHub 저장소 선택
2. Environment Variables에 `.env.local`에 채운 값을 **하나씩 그대로** 등록 (Production/Preview/Development 전체 체크)
3. Deploy 클릭
4. 배포가 끝나면 나오는 도메인을 `.env.local`의 `NEXT_PUBLIC_APP_BASE_URL`과 Vercel 환경변수 양쪽에도 반영 (공유 링크에 사용됨)

---

## 9. 사용 흐름 요약

```
관리자 로그인 → /admin에서 부서·사용자 등록
     ↓
/projects에서 프로젝트 생성
     ↓
/meetings/new 에서 회의 생성 (같은 프로젝트의 미결 사항이 자동으로 보입니다)
     ↓
회의 상세 화면에서 "이름: 발언내용" 형식으로 텍스트 회의록 입력 → 저장
     ↓
"AI 분석 실행" → 요약/질의/결정/액션아이템 초안 생성 → 담당자 매칭 확인 후 "전체 저장"
     ↓
"이전 미결사항 연결 제안 보기" → 기존 질의에 대한 답변으로 보이는 발언 확인 후 승인
     ↓
메인 대시보드에서 통합검색·미답변 질의 확인 / 공유 관리에서 외부 회사에 공유
```

---

## 10. 지금은 빠져 있는 것 (2차 범위)

기획서 자체가 "향후"로 표시했던 항목과, MVP에서 의도적으로 미룬 항목입니다.

- **자연어 AI 검색** (기획서 30장) — 현재는 회사/참석자/제목/날짜 AND 조건 검색만 지원합니다.
- **이메일·SMS·Slack·Teams·카카오워크 알림** (기획서 20장) — 현재는 앱 내 알림만 자동 발송됩니다. 사용자 계정 생성 시 초기 비밀번호를 이메일로 자동 발송하는 기능도 아직 없어, 관리자가 화면에 뜨는 초기 비밀번호를 직접 전달해야 합니다.
- **결정 이력 변경 UI** — 데이터 구조(`decisions/{id}/history`)는 준비되어 있으나, "결정 변경하기" 화면은 아직 없습니다.
- **회의 참가자 추가/권한 변경 화면** — 데이터 구조와 보안규칙은 갖춰져 있으나 전용 UI는 아직 없습니다 (현재는 회의 생성자만 자동으로 AUTHOR가 됩니다).

---

## 11. 폴더 구조

```
src/lib/types.ts                 기획서 엔터티 전체를 옮긴 타입 정의
firestore.rules                  회의 권한(AUTHOR/PARTICIPANT/VIEWER) 기반 보안규칙
functions/src/index.ts           알림 자동 발송 + 기한초과 자동 처리 (Cloud Functions)
src/lib/claude.ts                Claude API 분석 파이프라인
src/app/meetings/[id]/           회의 상세 (텍스트 입력 · AI 분석 · 질의/결정/액션아이템)
src/app/share/[token]/           외부 공유 접속 화면 (이메일 + 임시비밀번호)
scripts/seed.ts                  최초 회사/관리자 계정 부트스트랩
```
