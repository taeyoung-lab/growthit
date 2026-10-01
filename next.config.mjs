
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
  },
};
 
export default nextConfig;
