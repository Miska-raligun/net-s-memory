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
    <nav className="site-nav">
      <Link href="/" className="nav-brand">
        net-s-memory
      </Link>
      <Link href="/">记录</Link>
      <Link href="/events">事件</Link>
      <Link href="/candidates">候选</Link>
      <Link href="/transparency">透明度</Link>
      <span className="nav-spacer" />
      {user ? (
        <>
          <span className="nav-user">
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
