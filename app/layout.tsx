import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WeChat Radar",
  description: "Local-first WeChat group intelligence dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
