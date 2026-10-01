import type { Browser } from "puppeteer-core";

// 서버 전용 모듈입니다(Vercel 서버리스 함수 안에서만 실행). 로그인 단계에서만 헤드리스 브라우저가
// 필요하고, 로그인 이후 실제 데이터 수집은 collect.ts가 일반 fetch로 처리합니다(브라우저 기동은
// 느리고 무거우므로 꼭 필요한 로그인 단계에만 씁니다).
//
// Vercel 서버리스 환경에서는 @sparticuz/chromium이 제공하는 경량 크로미움 바이너리를 씁니다.
// 로컬 개발 환경에서는 PUPPETEER_EXECUTABLE_PATH 환경변수로 로컬에 설치된 Chrome 경로를 지정하세요
// (예: macOS "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").

export async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    // 2026-10-01 실제 배포에서 "libnss3.so: cannot open shared object file" 오류가 재현됨 —
    // headless 옵션 문제가 아니라(바꿔도 동일 오류 재현) @sparticuz/chromium 패키지 자체의
    // 버전 문제로 추정되어(당시 pinned 버전 131.0.1는 공식 저장소 기준 한참 구버전), 패키지를
    // 최신(puppeteer-core도 함께)으로 올려 재시도합니다. 로그인 단계는 WebGL이 필요 없어
    // setGraphicsMode도 꺼서 불필요한 그래픽 관련 공유 라이브러리 의존을 줄입니다.
    // https://github.com/Sparticuz/chromium#readme
    chromium.setGraphicsMode = false;
    // 최신 @sparticuz/chromium은 chromium.defaultViewport를 더 이상 제공하지 않아
    // (타입 에러로 확인됨), 공식 예제처럼 직접 뷰포트 값을 지정합니다.
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, isLandscape: true, hasTouch: false },
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }

  const localPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!localPath) {
    throw new Error(
      "로컬 개발 환경에서는 PUPPETEER_EXECUTABLE_PATH 환경변수로 로컬 Chrome 실행 경로를 지정해야 합니다."
    );
  }
  return puppeteer.launch({ executablePath: localPath, headless: true });
}

