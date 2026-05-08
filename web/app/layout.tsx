import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "互联网记忆 net-s-memory",
  description: "可验证的互联网新闻档案",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <nav>
          <Link href="/">今日记录</Link>
          <Link href="/transparency">公开透明日志</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
