import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
  assetPrefix: process.env.BASE_PATH || '',
};
export default nextConfig;
