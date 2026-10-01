
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb", // 텍스트 회의록 붙여넣기가 길 수 있어 기본값보다 넉넉하게 설정
    },
    // @sparticuz/chromium은 자기 패키지 폴더(__dirname) 기준 상대경로로 bin(압축된 크로미움
    // 바이너리) 폴더를 찾는데, Next.js가 라우트 핸들러를 웹팩으로 번들링하면서 이 경로가
    // ".next/server/bin"으로 뒤틀려버려 "input directory ... bin does not exist" 오류가 납니다.
    // 이 패키지들을 번들링 대상에서 제외(external)해야 실제 node_modules 위치가 유지되고,
    // Vercel 배포 시 output file tracing이 bin 폴더까지 정상적으로 포함합니다.
    serverComponentsExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
    // 2026-10-01: 위 external 설정만으로는 부족했습니다. @sparticuz/chromium 153.x는 순수 ESM
    // 패키지로, bin 폴더 경로를 `fileURLToPath(import.meta.url)` 기반으로 "동적으로" 계산합니다
    // (paths.js의 getBinPath()). Next.js의 자동 파일 추적(@vercel/nft)은 import/require 구문과
    // 일부 fs 패턴만 정적으로 분석하는데, 이런 동적 경로 계산 패턴은 감지하지 못해 실제 배포
    // 번들에서 bin/*.br 파일들이 통째로 빠지고 "input directory ... bin does not exist" 오류가
    // 재발했습니다(Vercel 로그에서 정확한 경로가 getBinPath()의 계산 결과와 일치함을 확인함).
    // Next.js 공식 문서가 이런 "추적 누락" 상황을 위해 제공하는 해결책이 outputFileTracingIncludes
    // 입니다 — 명시적으로 해당 글롭 패턴의 파일들을 서버리스 함수 번들에 강제로 포함시킵니다.
    // https://nextjs.org/docs/14/app/api-reference/next-config-js/output
    outputFileTracingIncludes: {
      "/api/**/*": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    },
  },
};
 
export default nextConfig;
