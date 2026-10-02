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
// 2026-10-02: 브레댄코(테스트_브래덴코) 테스트계정(test0101)으로 Chrome에서 직접 로그인해 전화번호
// 인증 화면 구조를 확인했습니다. 이전 버전은 "Sign me in"을 먼저 눌러 로그인을 마친 뒤 별도의 인증
// 화면이 뜬다고 가정했는데, 실제로는 그런 화면 전환이 전혀 없습니다 — 전화번호(마스킹 표시) /
// "인증번호발송" 버튼 / 인증번호 입력란(placeholder "Certification Number", 한글 "인증"이 아니라
// 영문 placeholder)이 아이디·비밀번호 입력란과 함께 로그인 폼 한 화면에 처음부터 같이 떠 있고,
// 모든 값을 다 채운 뒤 "Sign me in" 한 번으로 제출합니다. 이전 코드는 (1) 아이디/비밀번호만 채운 채
// 제출 버튼을 먼저 눌러 미완성 폼을 제출하고 (2) 존재하지 않는 "인증 화면 전환"을 기다리고
// (3) 인증번호 입력란을 한글 "인증" 포함 placeholder로 찾아 매번 못 찾고 있었습니다 — 이 세 가지가
// 겹쳐 60초 플랫폼 타임아웃까지 소진했던 것으로 보입니다. 아래 코드는 실제 화면 구조에 맞춰 전화번호
// 인증이 필요하면 "Sign me in"을 누르기 전에 인증번호까지 먼저 채워 넣도록 순서를 바로잡았습니다.

const ID_INPUT_SELECTOR = 'input[placeholder="Id"]';
const PASSWORD_INPUT_SELECTOR = 'input[placeholder="Password"][type="password"]';
// puppeteer-core v23부터 Page.$x()가 제거되어, 공식 가이드대로 'xpath/' 접두사를 붙인 일반 셀렉터로
// 씁니다 (https://pptr.dev/guides/page-interactions#xpath-selectors--p-xpath).
const SUBMIT_BUTTON_XPATH = "xpath/.//button[@type='submit' and contains(., 'Sign me in')]";
const SEND_CODE_BUTTON_XPATH = "xpath/.//button[contains(., '인증번호발송')]";
const CODE_INPUT_SELECTOR = 'input[placeholder="Certification Number"]';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginToCms(config: CmsLoginConfig): Promise<CmsSession> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const loginUrl = new URL("/login", config.cmsUrl).toString();
    await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: 30000 });

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

    // 전화번호 인증이 필요한 브랜드는 "Sign me in"을 누르기 전에 인증번호까지 먼저 채워야 합니다
    // (같은 화면에 이미 떠 있는 필드라 별도 화면 전환을 기다릴 필요가 없습니다 — 상단 주석 참고).
    if (config.phoneVerificationRequired) {
      await requestAndFillPhoneVerification(page, config.fixedVerificationCode);
    }

    const [submitButton] = await page.$$(SUBMIT_BUTTON_XPATH);
    if (!submitButton) {
      throw new CmsAutomationError("로그인 버튼(Sign me in)을 찾지 못했습니다.", "LOGIN");
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => null),
      submitButton.click(),
    ]);

    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      throw new CmsAutomationError(
        "로그인에 실패했습니다(로그인 화면에 그대로 머물러 있음) — 저장된 CMS 계정 정보를 확인해주세요.",
        "LOGIN"
      );
    }

    const cookies = await page.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    return { cookieHeader };
  } finally {
    await browser.close();
  }
}

// 2026-10-02 브레댄코 실제 화면으로 검증한 분기(상단 주석 참고). 로그인 폼과 같은 화면에서
// "인증번호발송" 버튼을 눌러 인증번호를 전송한 뒤, 인증번호 입력란(placeholder "Certification
// Number")에 고정 인증번호를 채워 넣기만 합니다 — 제출은 호출부에서 "Sign me in" 한 번으로 합니다.
async function requestAndFillPhoneVerification(
  page: import("puppeteer-core").Page,
  fixedCode: string | null
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
      "인증번호발송 버튼을 찾지 못했습니다 — 실제 화면 구조 확인이 필요합니다(login.ts 참고).",
      "PHONE_VERIFICATION"
    );
  }
  await sendCodeButton.click();
  // 테스트 계정은 고정 인증번호라 실제 SMS 수신을 기다릴 필요가 없어 짧게만 대기합니다.
  await delay(1500);

  await page.waitForSelector(CODE_INPUT_SELECTOR, { timeout: 10000 }).catch(() => {
    throw new CmsAutomationError(
      "전화번호 인증번호 입력란을 찾지 못했습니다 — 실제 화면 구조 확인이 필요합니다(login.ts 참고).",
      "PHONE_VERIFICATION"
    );
  });
  await page.click(CODE_INPUT_SELECTOR);
  await page.type(CODE_INPUT_SELECTOR, fixedCode, { delay: 20 });
}

