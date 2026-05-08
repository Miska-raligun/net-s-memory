from pathlib import Path

from app.crypto.keys import load_or_create_signing_key, sign, verify


def test_create_then_load(tmp_path: Path) -> None:
    p = tmp_path / "service.ed25519"
    k1 = load_or_create_signing_key(p)
    assert p.exists()
    k2 = load_or_create_signing_key(p)
    assert k1.encode() == k2.encode()


def test_sign_verify_round_trip(tmp_path: Path) -> None:
    k = load_or_create_signing_key(tmp_path / "k")
    pub = k.verify_key
    sig = sign(k, b"hello")
    assert verify(pub, b"hello", sig) is True


def test_tampered_message_rejected(tmp_path: Path) -> None:
    k = load_or_create_signing_key(tmp_path / "k")
    pub = k.verify_key
    sig = sign(k, b"hello")
    assert verify(pub, b"hellp", sig) is False


def test_tampered_signature_rejected(tmp_path: Path) -> None:
    k = load_or_create_signing_key(tmp_path / "k")
    pub = k.verify_key
    sig = sign(k, b"hello")
    bad_sig = bytes([sig[0] ^ 0xFF]) + sig[1:]
    assert verify(pub, b"hello", bad_sig) is False
