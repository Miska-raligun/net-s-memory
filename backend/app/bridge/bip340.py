"""BIP-340 Schnorr signatures over secp256k1 (pure Python).

Vendored from the BIP-340 reference implementation (public domain) so the
Nostr bridge can sign events without a native secp256k1 dependency. Pure
Python is slow, but the bridge only signs a handful of seed events at a time.

Nostr (NIP-01) uses exactly these primitives: x-only public keys and BIP-340
signatures over the 32-byte event id.
"""

from __future__ import annotations

import hashlib

p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (
    0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
    0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8,
)

Point = tuple[int, int] | None


def tagged_hash(tag: str, msg: bytes) -> bytes:
    tag_hash = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(tag_hash + tag_hash + msg).digest()


def is_infinite(point: Point) -> bool:
    return point is None


def x(point: Point) -> int:
    assert not is_infinite(point)
    return point[0]


def y(point: Point) -> int:
    assert not is_infinite(point)
    return point[1]


def point_add(p1: Point, p2: Point) -> Point:
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    if x(p1) == x(p2) and y(p1) != y(p2):
        return None
    if p1 == p2:
        lam = (3 * x(p1) * x(p1) * pow(2 * y(p1), p - 2, p)) % p
    else:
        lam = ((y(p2) - y(p1)) * pow(x(p2) - x(p1), p - 2, p)) % p
    x3 = (lam * lam - x(p1) - x(p2)) % p
    return (x3, (lam * (x(p1) - x3) - y(p1)) % p)


def point_mul(point: Point, scalar: int) -> Point:
    r: Point = None
    for i in range(256):
        if (scalar >> i) & 1:
            r = point_add(r, point)
        point = point_add(point, point)
    return r


def bytes_from_int(x_int: int) -> bytes:
    return x_int.to_bytes(32, byteorder="big")


def lift_x(b: bytes) -> Point:
    x_int = int.from_bytes(b, byteorder="big")
    if x_int >= p:
        return None
    y_sq = (pow(x_int, 3, p) + 7) % p
    y_int = pow(y_sq, (p + 1) // 4, p)
    if pow(y_int, 2, p) != y_sq:
        return None
    return (x_int, y_int if y_int & 1 == 0 else p - y_int)


def has_even_y(point: Point) -> bool:
    assert not is_infinite(point)
    return y(point) % 2 == 0


def pubkey_gen(seckey: bytes) -> bytes:
    d0 = int.from_bytes(seckey, byteorder="big")
    if not (1 <= d0 <= n - 1):
        raise ValueError("secret key out of range")
    point = point_mul(G, d0)
    assert point is not None
    return bytes_from_int(x(point))


def schnorr_sign(msg: bytes, seckey: bytes, aux_rand: bytes) -> bytes:
    if len(msg) != 32:
        raise ValueError("message must be 32 bytes")
    d0 = int.from_bytes(seckey, byteorder="big")
    if not (1 <= d0 <= n - 1):
        raise ValueError("secret key out of range")
    if len(aux_rand) != 32:
        raise ValueError("aux_rand must be 32 bytes")
    point = point_mul(G, d0)
    assert point is not None
    d = d0 if has_even_y(point) else n - d0
    t = (d ^ int.from_bytes(tagged_hash("BIP0340/aux", aux_rand), "big")).to_bytes(32, "big")
    k0 = int.from_bytes(tagged_hash("BIP0340/nonce", t + bytes_from_int(x(point)) + msg), "big") % n
    if k0 == 0:
        raise RuntimeError("nonce generation failed")
    r = point_mul(G, k0)
    assert r is not None
    k = k0 if has_even_y(r) else n - k0
    e = (
        int.from_bytes(
            tagged_hash("BIP0340/challenge", bytes_from_int(x(r)) + bytes_from_int(x(point)) + msg),
            "big",
        )
        % n
    )
    sig = bytes_from_int(x(r)) + bytes_from_int((k + e * d) % n)
    if not schnorr_verify(msg, bytes_from_int(x(point)), sig):
        raise RuntimeError("signing produced an invalid signature")
    return sig


def schnorr_verify(msg: bytes, pubkey: bytes, sig: bytes) -> bool:
    if len(msg) != 32 or len(pubkey) != 32 or len(sig) != 64:
        return False
    point = lift_x(pubkey)
    if point is None:
        return False
    r = int.from_bytes(sig[0:32], "big")
    s = int.from_bytes(sig[32:64], "big")
    if r >= p or s >= n:
        return False
    e = (
        int.from_bytes(
            tagged_hash("BIP0340/challenge", sig[0:32] + pubkey + msg), "big"
        )
        % n
    )
    big_r = point_add(point_mul(G, s), point_mul(point, n - e))
    return not (big_r is None or not has_even_y(big_r) or x(big_r) != r)
