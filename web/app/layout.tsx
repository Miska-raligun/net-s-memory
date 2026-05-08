import "./globals.css";
import type { ReactNode } from "react";

import Nav from "@/components/Nav";

export const metadata = {
  title: "互联网记忆 net-s-memory",
  description: "可验证的互联网新闻档案",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
