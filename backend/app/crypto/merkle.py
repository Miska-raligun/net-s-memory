"""RFC 6962 / RFC 9162 style append-only Merkle tree.

Leaf hash:  SHA-256(0x00 || data)
Node hash:  SHA-256(0x01 || left || right)

All public functions take and return raw 32-byte digests. Callers compute
``leaf_hash(data)`` themselves before adding leaves to the log.
"""

from __future__ import annotations

import hashlib

LEAF_PREFIX = b"\x00"
NODE_PREFIX = b"\x01"


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def leaf_hash(data: bytes) -> bytes:
    return _sha256(LEAF_PREFIX + data)


def node_hash(left: bytes, right: bytes) -> bytes:
    return _sha256(NODE_PREFIX + left + right)


def _largest_pow2_lt(n: int) -> int:
    if n < 2:
        raise ValueError("n must be >= 2")
    return 1 << ((n - 1).bit_length() - 1)


def merkle_root(hashes: list[bytes]) -> bytes:
    n = len(hashes)
    if n == 0:
        raise ValueError("merkle_root requires at least one leaf")
    if n == 1:
        return hashes[0]
    k = _largest_pow2_lt(n)
    return node_hash(merkle_root(hashes[:k]), merkle_root(hashes[k:]))


def inclusion_proof(index: int, hashes: list[bytes]) -> list[bytes]:
    n = len(hashes)
    if not 0 <= index < n:
        raise IndexError(f"index {index} out of range for tree of size {n}")
    if n == 1:
        return []
    k = _largest_pow2_lt(n)
    if index < k:
        return inclusion_proof(index, hashes[:k]) + [merkle_root(hashes[k:])]
    return inclusion_proof(index - k, hashes[k:]) + [merkle_root(hashes[:k])]


def consistency_proof(m: int, hashes: list[bytes]) -> list[bytes]:
    n = len(hashes)
    if not 1 <= m <= n:
        raise ValueError(f"m must satisfy 1 <= m <= n; got m={m}, n={n}")
    return _subproof(m, hashes, complete=True)


def _subproof(m: int, hashes: list[bytes], complete: bool) -> list[bytes]:
    n = len(hashes)
    if m == n:
        return [] if complete else [merkle_root(hashes)]
    k = _largest_pow2_lt(n)
    if m <= k:
        return _subproof(m, hashes[:k], complete) + [merkle_root(hashes[k:])]
    return _subproof(m - k, hashes[k:], complete=False) + [merkle_root(hashes[:k])]


def verify_inclusion(
    leaf: bytes,
    index: int,
    tree_size: int,
    proof: list[bytes],
    root: bytes,
) -> bool:
    if tree_size <= 0 or not 0 <= index < tree_size:
        return False
    fn, sn = index, tree_size - 1
    r = leaf
    for p in proof:
        if sn == 0:
            return False
        if fn & 1 or fn == sn:
            r = node_hash(p, r)
            if not (fn & 1):
                while not (fn & 1) and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            r = node_hash(r, p)
        fn >>= 1
        sn >>= 1
    return sn == 0 and r == root


def verify_consistency(
    m: int,
    n: int,
    proof: list[bytes],
    old_root: bytes,
    new_root: bytes,
) -> bool:
    if m < 1 or m > n:
        return False
    if m == n:
        return old_root == new_root and not proof

    path = [old_root, *proof] if (m & (m - 1)) == 0 else list(proof)
    if not path:
        return False

    fn = m - 1
    sn = n - 1
    while fn & 1:
        fn >>= 1
        sn >>= 1

    fr = path[0]
    sr = path[0]

    for c in path[1:]:
        if sn == 0:
            return False
        if fn & 1 or fn == sn:
            fr = node_hash(c, fr)
            sr = node_hash(c, sr)
            while not (fn & 1) and fn != 0:
                fn >>= 1
                sn >>= 1
        else:
            sr = node_hash(sr, c)
        fn >>= 1
        sn >>= 1

    return sn == 0 and fr == old_root and sr == new_root
