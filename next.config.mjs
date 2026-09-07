/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb", // 텍스트 회의록 붙여넣기가 길 수 있어 기본값보다 넉넉하게 설정
    },
  },
};

export default nextConfig;
