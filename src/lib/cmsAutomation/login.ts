import { launchBrowser } from "./browser";
import { CmsAutomationError, type CmsLoginConfig, type CmsSession } from "./types";

// 그로스잇 브랜드 CMS 자동 로그인.
//
// 2026-10-01 청자다방 테스트계정(test0101)으로 Chrome에서 직접 로그인해 확인한 로그인 화면 구조를
// 그대로 반영했습니다 — 로그인 폼은 아이디(placeholder "Id") / 비밀번호(placeholder "Password",
// type=password) 입력란 2개와 제출 버튼("Sign me in")뿐인 단순한 구조이고, 로그인에 성공하면
// /dashboard로 이동합니다. 8개 브랜드가 동일 코드베이스 기반 멀티테넌트 CMS로 추정되어 이 셀렉터를
// 공통으로 쓰되, 실제 연동 시 브랜드별로 한 번씩은 라이브 확인이 필요합니다(로그인 화면 문구나
// 구조가 브랜드별로 약간 다를 가능성을 배제할 수 없음).
//
// 2026-10-02: 브레댄코(테스트_브래덴코) 테스트계정(test0101)으로 Chrome에서 실제 로그인 전 과정을
// 화면 캡처로 확인해, 전화번호 인증 흐름을 다시 바로잡았습니다. 이전 두 버전은 모두 틀린 가정이었고
// (버전1: "Sign me in"을 먼저 눌러야 인증 화면이 뜬다 / 버전2: 인증 필드가 로그인 폼에 처음부터 같이
// 떠 있다), 실제 흐름은 이렇습니다:
//   1) 아이디·비밀번호만 입력하고 "Sign me in"을 누른다 — 화면 전환(URL 이동) 없이, 같은 화면에
//      전화번호(마스킹 표시)와 "인증번호발송" 버튼이 "새로" 나타난다.
//   2) "인증번호발송"을 누르면 네이티브 confirm 창("인증번호를 발송하시겠습니까?")이 뜬다 → 확인.
//   3) 이어서 네이티브 alert 창("인증번호가 발송되었습니다.")이 뜬다 → 확인.
//   4) 그제서야 인증번호 입력란이 나타난다 → 고정 인증번호를 입력한다. 이 입력란은 "Certification
//      Number"라는 안내 라벨이 옆에 붙어 있을 뿐, placeholder 속성은 비어 있고 id="authNum"만
//      있습니다(Chrome에서 input 속성을 직접 읽어 확인) — 이전 버전이 placeholder로 이 입력란을
//      찾으려다 매번 실패했던 이유입니다.
//   5) "Sign me in"을 다시 한번 눌러야 최종 로그인이 완료된다(같은 버튼, 두 번째 제출).
// 즉 "Sign me in"은 총 두 번 눌러야 하고, 중간에 뜨는 네이티브 confirm/alert 창을 자동으로 처리하는
// dialog 핸들러가 꼭 필요합니다(없으면 Puppeteer가 창이 뜬 채로 멈춰서 60초 플랫폼 타임아웃까지
// 간다고 추정됨). 이 버전은 이 다섯 단계를 그대로 코드로 옮긴 것입니다.

const ID_INPUT_SELECTOR = 'input[placeholder="Id"]';
const PASSWORD_INPUT_SELECTOR = 'input[placeholder="Password"][type="password"]';
// puppeteer-core v23부터 Page.$x()가 제거되어, 공식 가이드대로 'xpath/' 접두사를 붙인 일반 셀렉터로
// 씁니다 (https://pptr.dev/guides/page-interactions#xpath-selectors--p-xpath).
const SUBMIT_BUTTON_XPATH = "xpath/.//button[@type='submit' and contains(., 'Sign me in')]";
const SEND_CODE_BUTTON_XPATH = "xpath/.//button[contains(., '인증번호발송')]";
// 2026-10-02: "Certification Number"는 입력란의 placeholder가 아니라 옆에 붙은 안내 라벨 텍스트였을
// 뿐이었습니다 — 실제 input 엘리먼트는 placeholder가 비어 있고 id="authNum"만 있습니다(Chrome에서
// 직접 input 속성을 읽어 확인: outerHTML에 placeholder 속성 자체가 없음). placeholder 기반 셀렉터가
// 매번 아무것도 못 찾았던 이유였고, 그래서 waitForSelector가 실제로 존재하는 입력란을 두고도 매번
// 타임아웃났던 것입니다. id 기준으로 바꿉니다.
const CODE_INPUT_SELECTOR = "#authNum";

// browser.close()가 멈춘 렌더러를 기다리며 무한정 걸리는 경우를 대비한 안전장치.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[login] ${label} 단계가 ${ms}ms 안에 끝나지 않았습니다.`)), ms)
    ),
  ]);
}

export async function loginToCms(config: CmsLoginConfig): Promise<CmsSession> {
  const t0 = Date.now();
  const log = (step: string) => console.log(`[login] +${Date.now() - t0}ms ${step}`);

  const browser = await launchBrowser();
  log("browser launched");
  try {
    const page = await browser.newPage();
    // 브레댄코 등 전화번호 인증 브랜드는 "인증번호발송" 클릭 시 네이티브 confirm → alert 창이 순서대로
    // 뜹니다. 핸들러 없이는 Puppeteer가 응답을 못 받아 멈추므로, 모든 다이얼로그를 "확인"(accept)
    // 처리합니다 — confirm은 발송 진행, alert는 단순 확인 닫기라 accept 하나로 둘 다 충분합니다.
    page.on("dialog", (dialog) => {
      log(`dialog appeared (type=${dialog.type()}, message=${dialog.message()}) — accepting`);
      dialog.accept().catch(() => {});
    });
    await page.setViewport({ width: 1280, height: 900 });

    const loginUrl = new URL("/login", config.cmsUrl).toString();
    log(`goto ${loginUrl} start`);
    await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 30000 });
    log("goto done");

    await page.waitForSelector(ID_INPUT_SELECTOR, { timeout: 15000 }).catch(() => {
      throw new CmsAutomationError(
        `로그인 폼을 찾지 못했습니다(${loginUrl}). CMS 화면 구조가 바뀌었을 수 있습니다.`,
        "LOGIN"
      );
    });

    await page.click(ID_INPUT_SELECTOR);
    await page.type(ID_INPUT_SELECTOR, config.username, { delay: 20 });
    await page.click(PASSWORD_INPUT_SELECTOR);
    await page.type(PASSWORD_INPUT_SELECTOR, config.password, { delay: 20 });
    log("id/password typed");

    // 1차 제출: 아이디·비밀번호만으로 누른다. 전화번호 인증이 필요한 브랜드는 이 제출로 화면 이동 없이
    // "인증번호발송" 버튼이 새로 나타나고, 아닌 브랜드는 이 제출 자체가 곧 로그인 완료(실제 네비게이션)
    // 이다. 어느 쪽인지 미리 알 수 없으므로 "네비게이션 발생" 또는 "인증번호발송 버튼 등장" 중 먼저
    // 일어나는 쪽을 기다려 불필요한 대기를 줄인다.
    await clickSubmit(page, log, {
      alsoRaceWith: config.phoneVerificationRequired
        ? page.waitForSelector(SEND_CODE_BUTTON_XPATH, { timeout: 20000 })
        : null,
    });

    if (config.phoneVerificationRequired) {
      log("phone verification start");
      await requestAndFillPhoneVerification(page, config.fixedVerificationCode, log);
      log("phone verification done, submitting again to complete login");
      // 2차 제출: 인증번호까지 채운 뒤 같은 버튼을 다시 눌러야 실제 로그인이 완료된다(실제 네비게이션).
      await clickSubmit(page, log, { alsoRaceWith: null });
    }

    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      throw new CmsAutomationError(
        "로그인에 실패했습니다(로그인 화면에 그대로 머물러 있음) — 저장된 CMS 계정 정보 또는 고정 인증번호를 확인해주세요.",
        "LOGIN"
      );
    }

    const cookies = await page.cookies();
    log("cookies collected, returning");
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    return { cookieHeader };
  } finally {
    log("closing browser");
    await withTimeout(browser.close(), 5000, "browser.close()").catch((err) => {
      log(`browser.close() did not finish cleanly: ${err}`);
    });
    log("browser close step finished");
  }
}

async function clickSubmit(
  page: import("puppeteer-core").Page,
  log: (step: string) => void,
  options: { alsoRaceWith: ReturnType<import("puppeteer-core").Page["waitForSelector"]> | null }
): Promise<void> {
  const [submitButton] = await page.$$(SUBMIT_BUTTON_XPATH);
  if (!submitButton) {
    throw new CmsAutomationError("로그인 버튼(Sign me in)을 찾지 못했습니다.", "LOGIN");
  }

  log("submit click start");
  const waiters = [page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })];
  if (options.alsoRaceWith) {
    waiters.push(options.alsoRaceWith as ReturnType<typeof page.waitForNavigation>);
  }

  await Promise.all([Promise.race(waiters).catch(() => null), submitButton.click()]);
  log("submit click / wait done");
}

// 2026-10-02 브레댄코 실제 화면으로 검증한 분기(상단 주석 참고). 이 시점에는 이미 1차 제출로
// "인증번호발송" 버튼이 화면에 나타나 있어야 한다(호출부에서 보장). 버튼을 누르면 뜨는 네이티브
// confirm/alert 창은 상단에서 등록한 공용 dialog 핸들러가 자동으로 처리한다.
async function requestAndFillPhoneVerification(
  page: import("puppeteer-core").Page,
  fixedCode: string | null,
  log: (step: string) => void
): Promise<void> {
  if (!fixedCode) {
    throw new CmsAutomationError(
      "이 브랜드는 전화번호 인증이 필요한데 고정 인증번호가 저장돼 있지 않습니다.",
      "PHONE_VERIFICATION"
    );
  }

  const [sendCodeButton] = await page.$$(SEND_CODE_BUTTON_XPATH);
  if (!sendCodeButton) {
    throw new CmsAutomationError(
      "1차 제출(아이디/비밀번호) 후에도 인증번호발송 버튼이 나타나지 않았습니다 — 저장된 계정 정보 또는 화면 구조를 확인해주세요.",
      "PHONE_VERIFICATION"
    );
  }

  log("clicking 인증번호발송 (뒤따르는 confirm/alert 창은 자동 처리됨)");
  await sendCodeButton.click();

  // 2026-10-02: 실제 운영에서는 confirm/alert 두 창 모두 정상적으로 자동 처리되는 것까지 로그로
  // 확인했는데도, 그 다음 인증번호 입력란이 15초 안에 나타나지 않는 현상이 재현됨. SMS 발송이
  // 실제로는 더 오래 걸릴 가능성을 열어두고 대기 시간을 늘렸고, 그래도 실패하면 그 순간 페이지에
  // 실제로 뭐가 떠 있는지(에러 메시지 등) 로그로 남겨서 다음 번엔 추측 없이 바로 알 수 있게 합니다.
  log("waiting for Certification Number input to appear (최대 35초)");
  await page.waitForSelector(CODE_INPUT_SELECTOR, { timeout: 35000 }).catch(async () => {
    const bodyText = await page
      .evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 1000))
      .catch((err) => `(페이지 상태 읽기 실패: ${err})`);
    log(`code input 대기 실패 시점의 화면 텍스트: ${bodyText}`);
    throw new CmsAutomationError(
      "전화번호 인증번호 입력란이 나타나지 않았습니다 — 실제 화면 구조 확인이 필요합니다(login.ts 참고).",
      "PHONE_VERIFICATION"
    );
  });
  log("code input found, typing code");
  await page.click(CODE_INPUT_SELECTOR);
  await page.type(CODE_INPUT_SELECTOR, fixedCode, { delay: 20 });
  log("code typed");
}
