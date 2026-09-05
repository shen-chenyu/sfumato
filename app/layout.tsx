import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Sfumato · the moment you recognize it',
  description:
    'Watch a hidden photograph emerge from mathematical curves. Stop when you recognize it, reveal the original, and see how much you can take away. Photos stay on your device.',
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
