// Nostr identity (secp256k1 / schnorr, per NIP-01). This is intentionally a
// *different* key than net-s-memory's Ed25519 identity: going Nostr-native
// lets us reuse public relays, NIP-02 follow graphs, and existing signers,
// at the cost of not reusing the server's Ed25519 keys directly.

import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { bytesToHex, hexToBytes } from "../canonical";

export interface NostrIdentity {
  skHex: string;
  pubkey: string;
  npub: string;
}

export function identityFromSk(skHex: string): NostrIdentity {
  const pubkey = getPublicKey(hexToBytes(skHex));
  return { skHex, pubkey, npub: nip19.npubEncode(pubkey) };
}

export function createIdentity(): NostrIdentity {
  return identityFromSk(bytesToHex(generateSecretKey()));
}

/** Decode an `nsec1...` bech32 secret key into an identity. */
export function importNsec(nsec: string): NostrIdentity {
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== "nsec") {
    throw new Error("不是有效的 nsec 私钥");
  }
  return identityFromSk(bytesToHex(decoded.data as Uint8Array));
}

export function nsecOf(skHex: string): string {
  return nip19.nsecEncode(hexToBytes(skHex));
}
