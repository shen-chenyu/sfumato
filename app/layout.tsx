import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Sfumato · a computational drawing playground',
  description:
    'Turn a photograph into a drawing, one calculated stroke at a time. Replay every decision and keep the moment it becomes enough. Your photos stay in your browser.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
