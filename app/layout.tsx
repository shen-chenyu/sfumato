import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Sfumato · editable mathematical portraits',
  description:
    'Construct a portrait from explicit curves and harmonic tone. Inspect equations, edit control points, and redraw from a recipe without the original photograph.',
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
