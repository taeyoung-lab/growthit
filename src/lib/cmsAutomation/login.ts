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
// 브레댄코의 "전화번호 인증(고정 인증번호)" 분기는 이전 대화에서 사용자가 설명해준 내용(버튼 클릭 →
// 인증번호 입력란 노출)을 바탕으로 작성했을 뿐, 이 모듈을 작성하며 그 화면을 직접 본 적은 없습니다.
// 브레댄코로 처음 실행할 때는 반드시 결과를 확인하고, 실패하면 아래 PHONE_VERIFICATION 단계의
// 셀렉터(버튼/입력란 텍스트)를 실제 화면에 맞게 조정해야 합니다.

const ID_INPUT_SELECTOR = 'input[placeholder="Id"]';
const PASSWORD_INPUT_SELECTOR = 'input[placeholder="Password"][type="password"]';
// puppeteer-core v23부터 Page.$x()가 제거되어, 공식 가이드대로 'xpath/' 접두사를 붙인 일반 셀렉터로
// 씁니다 (https://pptr.dev/guides/page-interactions#xpath-selectors--p-xpath).
const SUBMIT_BUTTON_XPATH = "xpath/.//button[@type='submit' and contains(., 'Sign me in')]";

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

    const [submitButton] = await page.$$(SUBMIT_BUTTON_XPATH);
    if (!submitButton) {
      throw new CmsAutomationError("로그인 버튼(Sign me in)을 찾지 못했습니다.", "LOGIN");
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => null),
      submitButton.click(),
    ]);

    if (config.phoneVerificationRequired) {
      await handlePhoneVerification(page, config.fixedVerificationCode);
    }

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

// 미검증 분기 — 상단 주석 참고. type은 puppeteer-core의 Page를 그대로 쓰되, 이 파일만 보고도
// 셀렉터를 고칠 수 있도록 일부러 구체적인 텍스트 매칭을 썼습니다.
async function handlePhoneVerification(
  page: import("puppeteer-core").Page,
  fixedCode: string | null
): Promise<void> {
  if (!fixedCode) {
    throw new CmsAutomationError(
      "이 브랜드는 전화번호 인증이 필요한데 고정 인증번호가 저장돼 있지 않습니다.",
      "PHONE_VERIFICATION"
    );
  }

  const [sendCodeButton] = await page.$$("xpath/.//button[contains(., '인증')]");
  if (sendCodeButton) {
    await sendCodeButton.click();
    await delay(1000);
  }

  const codeInputSelector = 'input[placeholder*="인증"]';
  await page.waitForSelector(codeInputSelector, { timeout: 10000 }).catch(() => {
    throw new CmsAutomationError(
      "전화번호 인증번호 입력란을 찾지 못했습니다 — 실제 화면 구조 확인이 필요합니다(login.ts의 handlePhoneVerification 참고).",
      "PHONE_VERIFICATION"
    );
  });
  await page.type(codeInputSelector, fixedCode, { delay: 20 });

  const [confirmButton] = await page.$$("xpath/.//button[contains(., '확인') or contains(., '인증')]");
  if (confirmButton) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null),
      confirmButton.click(),
    ]);
  }
}

