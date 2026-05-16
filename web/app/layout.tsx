import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: {
    default: "互联网记忆",
    template: "%s · 互联网记忆",
  },
  description:
    "可验证的互联网新闻档案 — 每条记录经 Ed25519 签名写入追加式 Merkle 日志，锚定至比特币时间戳，不可篡改、不可删除。",
  openGraph: {
    type: "website",
    siteName: "互联网记忆 net-s-memory",
    title: "互联网记忆",
    description: "可验证的互联网新闻档案 — 签名、Merkle 日志、比特币锚定",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
