import { API_BASE } from "./api";
import { bytesToHex } from "./canonical";
import {
  type AuthUser,
  clearSession,
  decryptSeed,
  encryptSeed,
  generateKeypair,
  getToken,
  getUser,
  persistSession,
} from "./identity";

interface AuthResponse {
  user: AuthUser;
  token: string;
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const { seed, publicKey } = await generateKeypair();
  const encrypted = await encryptSeed(seed, password);

  const r = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      pubkey: bytesToHex(publicKey),
      encrypted_privkey: bytesToHex(encrypted),
    }),
  });
  if (!r.ok) throw new Error(await readError(r, "signup"));
  const body = (await r.json()) as AuthResponse;
  persistSession(body.token, body.user, seed);
  return body.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const r = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(await readError(r, "login"));
  const body = (await r.json()) as AuthResponse;

  if (!body.user.encrypted_privkey) {
    throw new Error("此账号尚未保存加密私钥，无法在浏览器解锁。");
  }
  const blob = hex(body.user.encrypted_privkey);
  let seed: Uint8Array;
  try {
    seed = await decryptSeed(blob, password);
  } catch {
    throw new Error("密码不匹配，无法解密私钥");
  }
  persistSession(body.token, body.user, seed);
  return body.user;
}

export function logout(): void {
  clearSession();
}

export { getToken, getUser };

export function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(r: Response, action: string): Promise<string> {
  try {
    const body = await r.json();
    return `${action} 失败 (${r.status}): ${body.detail ?? r.statusText}`;
  } catch {
    return `${action} 失败 (${r.status})`;
  }
}

function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}
