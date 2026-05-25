from hypothesis import given, settings
from hypothesis import strategies as st

from app.crypto.merkle import (
    consistency_proof,
    inclusion_proof,
    leaf_hash,
    merkle_root,
    node_hash,
    verify_consistency,
    verify_inclusion,
)


def _hashes(data_list: list[bytes]) -> list[bytes]:
    return [leaf_hash(d) for d in data_list]


def test_single_leaf_root_is_leaf_hash() -> None:
    h = leaf_hash(b"x")
    assert merkle_root([h]) == h


def test_two_leaf_root() -> None:
    h0, h1 = leaf_hash(b"a"), leaf_hash(b"b")
    assert merkle_root([h0, h1]) == node_hash(h0, h1)


def test_three_leaf_root_is_asymmetric() -> None:
    hs = _hashes([b"a", b"b", b"c"])
    expected = node_hash(node_hash(hs[0], hs[1]), hs[2])
    assert merkle_root(hs) == expected


def test_inclusion_proof_for_single_leaf_is_empty() -> None:
    h = leaf_hash(b"x")
    assert inclusion_proof(0, [h]) == []
    assert verify_inclusion(h, 0, 1, [], h) is True


@given(
    data=st.lists(st.binary(max_size=32), min_size=1, max_size=200),
    idx_seed=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=200)
def test_inclusion_round_trip(data: list[bytes], idx_seed: int) -> None:
    hs = _hashes(data)
    n = len(hs)
    idx = idx_seed % n
    root = merkle_root(hs)
    proof = inclusion_proof(idx, hs)
    assert verify_inclusion(hs[idx], idx, n, proof, root) is True


@given(
    data=st.lists(st.binary(max_size=32), min_size=2, max_size=100),
    idx_seed=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=100)
def test_inclusion_rejects_tampered_leaf(data: list[bytes], idx_seed: int) -> None:
    hs = _hashes(data)
    n = len(hs)
    idx = idx_seed % n
    root = merkle_root(hs)
    proof = inclusion_proof(idx, hs)
    tampered = bytes([hs[idx][0] ^ 0xFF]) + hs[idx][1:]
    assert verify_inclusion(tampered, idx, n, proof, root) is False


@given(
    data=st.lists(st.binary(max_size=32), min_size=2, max_size=100),
    idx_seed=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=100)
def test_inclusion_rejects_tampered_root(data: list[bytes], idx_seed: int) -> None:
    hs = _hashes(data)
    n = len(hs)
    idx = idx_seed % n
    root = merkle_root(hs)
    proof = inclusion_proof(idx, hs)
    bad_root = bytes([root[0] ^ 0xFF]) + root[1:]
    assert verify_inclusion(hs[idx], idx, n, proof, bad_root) is False


@given(
    data=st.lists(st.binary(max_size=32), min_size=3, max_size=100),
    idx_seed=st.integers(min_value=0, max_value=10_000),
    proof_pos=st.integers(min_value=0, max_value=64),
)
@settings(max_examples=100)
def test_inclusion_rejects_tampered_proof(
    data: list[bytes], idx_seed: int, proof_pos: int
) -> None:
    hs = _hashes(data)
    n = len(hs)
    idx = idx_seed % n
    root = merkle_root(hs)
    proof = inclusion_proof(idx, hs)
    if not proof:
        return
    pos = proof_pos % len(proof)
    bad = list(proof)
    bad[pos] = bytes([bad[pos][0] ^ 0xFF]) + bad[pos][1:]
    assert verify_inclusion(hs[idx], idx, n, bad, root) is False


@given(
    data=st.lists(st.binary(max_size=32), min_size=1, max_size=200),
    m_seed=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=200)
def test_consistency_round_trip(data: list[bytes], m_seed: int) -> None:
    new_hashes = _hashes(data)
    n = len(new_hashes)
    m = (m_seed % n) + 1
    old_hashes = new_hashes[:m]
    old_root = merkle_root(old_hashes)
    new_root = merkle_root(new_hashes)
    proof = consistency_proof(m, new_hashes)
    assert verify_consistency(m, n, proof, old_root, new_root) is True


@given(
    data=st.lists(st.binary(max_size=32), min_size=2, max_size=100),
    m_seed=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=100)
def test_consistency_rejects_tampered_old_root(data: list[bytes], m_seed: int) -> None:
    new_hashes = _hashes(data)
    n = len(new_hashes)
    m = (m_seed % (n - 1)) + 1  # m < n so proof is non-trivial
    old_root = merkle_root(new_hashes[:m])
    new_root = merkle_root(new_hashes)
    proof = consistency_proof(m, new_hashes)
    bad_old = bytes([old_root[0] ^ 0xFF]) + old_root[1:]
    assert verify_consistency(m, n, proof, bad_old, new_root) is False


@given(
    data=st.lists(st.binary(max_size=32), min_size=2, max_size=100),
    m_seed=st.integers(min_value=0, max_value=10_000),
)
@settings(max_examples=100)
def test_consistency_rejects_tampered_new_root(data: list[bytes], m_seed: int) -> None:
    new_hashes = _hashes(data)
    n = len(new_hashes)
    m = (m_seed % (n - 1)) + 1
    old_root = merkle_root(new_hashes[:m])
    new_root = merkle_root(new_hashes)
    proof = consistency_proof(m, new_hashes)
    bad_new = bytes([new_root[0] ^ 0xFF]) + new_root[1:]
    assert verify_consistency(m, n, proof, old_root, bad_new) is False


@given(
    data=st.lists(st.binary(max_size=32), min_size=3, max_size=100),
    m_seed=st.integers(min_value=0, max_value=10_000),
    proof_pos=st.integers(min_value=0, max_value=64),
)
@settings(max_examples=100)
def test_consistency_rejects_tampered_proof(
    data: list[bytes], m_seed: int, proof_pos: int
) -> None:
    new_hashes = _hashes(data)
    n = len(new_hashes)
    m = (m_seed % (n - 1)) + 1
    old_root = merkle_root(new_hashes[:m])
    new_root = merkle_root(new_hashes)
    proof = consistency_proof(m, new_hashes)
    if not proof:
        return
    pos = proof_pos % len(proof)
    bad = list(proof)
    bad[pos] = bytes([bad[pos][0] ^ 0xFF]) + bad[pos][1:]
    assert verify_consistency(m, n, bad, old_root, new_root) is False


def test_consistency_equal_sizes_requires_empty_proof() -> None:
    hs = _hashes([b"a", b"b", b"c"])
    root = merkle_root(hs)
    assert verify_consistency(3, 3, [], root, root) is True
    assert verify_consistency(3, 3, [hs[0]], root, root) is False


def test_consistency_rejects_m_greater_than_n() -> None:
    hs = _hashes([b"a", b"b"])
    root = merkle_root(hs)
    assert verify_consistency(3, 2, [], root, root) is False
