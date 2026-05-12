// Browser-side keypair management.
//
// At signup we generate an Ed25519 keypair, encrypt the seed (32 bytes)
// with a key derived from the user's password via Argon2id, and ship
// the encrypted blob to the server as backup. On login we ask the
// server for that blob and decrypt it locally — the password and seed
// never leave the browser unencrypted.
//
// Storage:
//   localStorage  nsm_user   = JSON {id,email,pubkey,...}
//   localStorage  nsm_token  = JWT bearer
//   sessionStorage nsm_seed  = hex seed, cleared when tab closes

import sodium from "libsodium-wrappers-sumo";

import { bytesToHex, canonicalEncode, hexToBytes } from "./canonical";

const SALT_LEN = 16;
const NONCE_LEN = 24;

export interface AuthUser {
  id: string;
  email: string;
  pubkey: string;
  encrypted_privkey: string | null;
  reputation: number;
  created_at: string;
}

export async function ready(): Promise<void> {
  await sodium.ready;
}

export async function generateKeypair(): Promise<{
  seed: Uint8Array;
  publicKey: Uint8Array;
}> {
  await ready();
  const seed = sodium.randombytes_buf(sodium.crypto_sign_SEEDBYTES);
  const kp = sodium.crypto_sign_seed_keypair(seed);
  return { seed, publicKey: kp.publicKey };
}

function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

export async function encryptSeed(
  seed: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  await ready();
  const salt = sodium.randombytes_buf(SALT_LEN);
  const nonce = sodium.randombytes_buf(NONCE_LEN);
  const key = deriveKey(password, salt);
  const ct = sodium.crypto_secretbox_easy(seed, nonce, key);
  // blob = salt(16) || nonce(24) || ciphertext
  const out = new Uint8Array(salt.length + nonce.length + ct.length);
  out.set(salt, 0);
  out.set(nonce, salt.length);
  out.set(ct, salt.length + nonce.length);
  return out;
}

export async function decryptSeed(
  blob: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  await ready();
  if (blob.length < SALT_LEN + NONCE_LEN) {
    throw new Error("encrypted blob too short");
  }
  const salt = blob.slice(0, SALT_LEN);
  const nonce = blob.slice(SALT_LEN, SALT_LEN + NONCE_LEN);
  const ct = blob.slice(SALT_LEN + NONCE_LEN);
  const key = deriveKey(password, salt);
  return sodium.crypto_secretbox_open_easy(ct, nonce, key);
}

export async function signCanonical(
  seed: Uint8Array,
  payload: object,
): Promise<{ canonical: Uint8Array; sig: Uint8Array }> {
  await ready();
  const kp = sodium.crypto_sign_seed_keypair(seed);
  const canonical = canonicalEncode(payload as never);
  const sig = sodium.crypto_sign_detached(canonical, kp.privateKey);
  return { canonical, sig };
}

const TOKEN_KEY = "nsm_token";
const USER_KEY = "nsm_user";
const SEED_KEY = "nsm_seed";

export function persistSession(token: string, user: AuthUser, seed: Uint8Array): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  sessionStorage.setItem(SEED_KEY, bytesToHex(seed));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(SEED_KEY);
}

export function getToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function getSeed(): Uint8Array | null {
  if (typeof window === "undefined") return null;
  const hex = sessionStorage.getItem(SEED_KEY);
  return hex ? hexToBytes(hex) : null;
}
