"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { signup } from "@/lib/auth";

export default function SignupPage() {
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
      await signup(email, password);
      router.push("/");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>注册</h1>
      <p style={{ fontSize: 14, color: "#555" }}>
        注册时浏览器会生成一个 Ed25519 密钥对。
        私钥会用你的密码（Argon2id）加密后作为备份发送给服务器，
        服务器**永远不会**看到明文私钥；登录时在浏览器解密即可继续签署投票。
      </p>
      <form onSubmit={onSubmit} style={{ marginTop: 16, display: "grid", gap: 8 }}>
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{ marginLeft: 8 }}
          />
        </label>
        <label>
          密码（≥ 8 位）
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={{ marginLeft: 8 }}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "注册中…" : "注册"}
        </button>
      </form>
      {err && <div className="fail" style={{ marginTop: 12 }}>{err}</div>}
    </main>
  );
}
