import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "微信雷达",
  description: "本地优先的微信群聊情报看板",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
