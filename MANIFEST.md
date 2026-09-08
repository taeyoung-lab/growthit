# growthit — 2026-09-08 반영 파일 안내 (Phase 10)

이 폴더의 파일들을 GitHub 저장소(`taeyoung-lab/growthit`)의 **같은 경로**에 그대로 덮어쓰기 하면 됩니다.
(`npm install` 후 `npx tsc --noEmit`, `npm run build` 모두 정상 통과 확인했습니다.)

## 1. 삭제할 파일 (더 이상 쓰지 않음 — AI 분석 기능 제거 + Cloud Functions 미사용)

- `src/lib/claude.ts`
- `functions/` 디렉토리 전체 (`functions/src/index.ts`, `functions/package.json`, `functions/tsconfig.json` 등)
- `src/app/api/meetings/[id]/analyze/route.ts` (및 상위 `analyze` 폴더)
- `src/app/api/meetings/[id]/link-suggestions/route.ts` (및 상위 `link-suggestions` 폴더)

## 2. 새로 추가하는 파일

| 경로 | 설명 |
|---|---|
| `src/lib/firebase/meetingAccess.ts` | 회의 권한 부여/회수 + `member_uids` 동기화 헬퍼 (Cloud Functions 대체) |
| `src/app/api/meetings/[id]/participants/route.ts` | 편집자가 참여자를 지정/해제하는 API |
| `src/app/api/account/mark-password-changed/route.ts` | 최초 비밀번호 재설정 완료 처리 |
| `src/app/api/account/mark-dashboard-visited/route.ts` | 알림 축소 기능 — 마지막 방문 시각 기록 |
| `src/app/change-password/page.tsx` | 최초 로그인 시 비밀번호 재설정 화면 |

## 3. 수정한 파일 (전체 파일이 새 버전으로 교체됨 — diff 아님, 그대로 덮어쓰기)

- `.env.example` — Anthropic 관련 항목 제거, `NEXT_PUBLIC_APP_BASE_URL` → `APP_BASE_URL`로 변경(서버 전용이라 브라우저 노출 불필요 — Vercel 경고 반영)
- `firebase.json` — `functions` 설정 제거 (Spark 요금제)
- `firestore.indexes.json` — notifications/transcripts 관련 인덱스 제거, actionItems 인덱스 정리
- `firestore.rules` — 권한 3단계(SUPER_ADMIN/ADMIN/USER) + 열람자(MeetingShare) 반영, notifications 규칙 제거
- `package.json` / `package-lock.json` — `@anthropic-ai/sdk` 의존성 제거
- `scripts/seed.ts` — 최초 관리자 계정 `org_role: SUPER_ADMIN`으로 생성
- `src/lib/types.ts` — 권한 3단계, Meeting에 장소/참석자 구조 추가, Transcript/AI 관련 타입 제거
- `src/lib/adminAuthCheck.ts` — `requireOrgAdmin` → `requireSuperAdmin`, `requireMeetingRole`이 SUPER_ADMIN/ADMIN을 자동 통과하도록 수정
- `src/lib/statusLabels.ts` — 더 이상 없는 `ANALYZING` 상태 라벨 제거
- `src/components/AuthGate.tsx` — 최초 로그인 시 `/change-password`로 강제 이동하는 로직 추가
- `src/components/Navbar.tsx` — 관리자 메뉴 노출 조건을 `SUPER_ADMIN`으로 변경
- `src/app/admin/page.tsx` — 인원관리 전체 재작성 (부서/권한 3단계, 수정/삭제/비밀번호 리셋 UI)
- `src/app/api/admin/users/route.ts` — 생성(초기비번 1234 고정)/수정/삭제(soft-delete)/비밀번호 리셋 전체 재작성
- `src/app/api/admin/organizations/route.ts`, `src/app/api/admin/departments/route.ts` — 권한 체크 함수명 변경
- `src/app/api/share/create/route.ts` — `member_uids` 동기화 로직 추가 (Cloud Functions 미사용 보완), 공유 URL 도메인 값을 `NEXT_PUBLIC_APP_BASE_URL` 대신 `APP_BASE_URL`(서버 전용)에서 읽도록 변경
- `src/app/meetings/new/page.tsx` — 4섹션(개요/회의요약/논의내용/향후추진과제) 구조화 입력 폼으로 전체 재작성 (AI 분석/텍스트 붙여넣기 제거)
- `src/app/meetings/[id]/page.tsx` — 읽기전용 4섹션 뷰 + 향후추진과제 상태 관리 + 문답(Q&A) 스레드 + 참여자 관리로 전체 재작성
- `src/app/meetings/[id]/share/page.tsx` — 라벨을 "열람자/참여자"로 명확화 (기능은 동일)
- `src/app/page.tsx` — 대시보드: 알림 벨 제거 → "지난 방문 이후 업데이트" 배지로 축소, 향후추진과제 담당자별 섹션 추가

## 4. 업로드 후 반드시 해야 할 일

1. GitHub에 위 변경사항을 반영한 뒤, 새로 만든 Firebase 프로젝트에 `firebase deploy --only firestore:rules,firestore:indexes` 실행 (별도로 안내드리는 Firebase 설정 가이드 참고)
2. `npm run seed` 로 최초 회사/부서/슈퍼관리자 계정 생성 (이 계정은 `org_role: SUPER_ADMIN`)
3. 이후 인원 추가는 `/admin` 화면에서 슈퍼관리자 계정으로 진행 (초기 비밀번호 1234 → 최초 로그인 시 재설정 필수)

## 5. 아직 반영되지 않은 것 (다음 단계)

- 배포처(Vercel 등) 확정 후 관련 설정(예: `NEXT_PUBLIC_APP_BASE_URL` 운영 도메인 반영)
- 회의 종료 후 후속 조치(예: 향후추진과제 마감일 지난 항목의 "기한초과" 자동 표시)는 Cloud Functions 없이 화면에서 직접 상태를 변경하는 방식으로 남겨뒀습니다 (요청하신 대로 자동 스케줄러는 생략).
