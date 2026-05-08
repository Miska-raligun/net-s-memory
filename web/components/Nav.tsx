"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { logout } from "@/lib/auth";
import { type AuthUser, getUser } from "@/lib/identity";

export default function Nav() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getUser());
    const onStorage = () => setUser(getUser());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <nav
      style={{
        display: "flex",
        gap: 16,
        padding: "8px 16px",
        borderBottom: "1px solid #ddd",
        alignItems: "center",
      }}
    >
      <Link href="/">首页</Link>
      <Link href="/transparency">透明度</Link>
      <span style={{ flex: 1 }} />
      {user ? (
        <>
          <span style={{ fontSize: 14, color: "#444" }}>
            {user.email} · 信誉 {user.reputation.toFixed(1)}
          </span>
          <button
            onClick={() => {
              logout();
              setUser(null);
            }}
          >
            登出
          </button>
        </>
      ) : (
        <>
          <Link href="/login">登录</Link>
          <Link href="/signup">注册</Link>
        </>
      )}
    </nav>
  );
}
