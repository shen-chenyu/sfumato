import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Sfumato · 多少数学，能描绘你？',
  description:
    'How much math describes you? 从照片生成数学自画像、真实方程与可重画的配方。完全本地计算。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
