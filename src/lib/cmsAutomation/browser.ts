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
    // @sparticuz/chromium이 제공하는 바이너리는 GUI 없이 빌드된 "chrome-headless-shell"입니다.
    // headless: true(일반 풀 크로미움 가정)로 실행하면 이 바이너리가 기대하지 않는 방식으로
    // 뜨면서 libnss3.so 등 공유 라이브러리를 찾지 못해 실패합니다(실제 배포에서 재현된 오류).
    // 공식 문서가 안내하는 대로 headless: "shell"과 puppeteer.defaultArgs를 그대로 따릅니다.
    // https://github.com/Sparticuz/chromium#readme
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      defaultViewport: chromium.defaultViewport,
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

