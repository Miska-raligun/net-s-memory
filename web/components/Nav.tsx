"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { logout } from "@/lib/auth";
import { type AuthUser, getUser } from "@/lib/identity";

const NAV_LINKS = [
  { href: "/", label: "记录" },
  { href: "/events", label: "事件" },
  { href: "/candidates", label: "候选" },
  { href: "/transparency", label: "透明度" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setUser(getUser());
    const onStorage = () => setUser(getUser());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <nav className="site-nav">
      <Link href="/" className="nav-brand">
        net-s-memory
      </Link>
      <button
        className="nav-toggle"
        onClick={() => setOpen(!open)}
        aria-label="菜单"
      >
        <span className={`nav-hamburger${open ? " nav-hamburger-open" : ""}`} />
      </button>
      <div className={`nav-links${open ? " nav-links-open" : ""}`}>
        {NAV_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={isActive(pathname, l.href) ? "nav-active" : ""}
          >
            {l.label}
          </Link>
        ))}
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
      </div>
    </nav>
  );
}
