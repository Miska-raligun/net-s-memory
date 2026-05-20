"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
      router.push("/");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>登录</h1>
      <div className="form-card">
        <p className="form-card-intro">
          登录后，浏览器会在本地解密你的 Ed25519 私钥，
          后续每次投票、发起合入提案都由你本地的私钥签名。
        </p>
        <form onSubmit={onSubmit} className="form-grid">
          <label className="form-label">
            邮箱
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="form-label">
            密码
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "解锁中…" : "登录"}
          </button>
        </form>
        {err && <div className="fail">{err}</div>}
      </div>
    </main>
  );
}
