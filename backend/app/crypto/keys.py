from __future__ import annotations

import os
from pathlib import Path

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey


def load_or_create_signing_key(path: str | os.PathLike[str]) -> SigningKey:
    p = Path(path)
    if p.exists():
        return SigningKey(p.read_bytes())
    p.parent.mkdir(parents=True, exist_ok=True)
    key = SigningKey.generate()
    p.write_bytes(key.encode())
    p.chmod(0o600)
    return key


def sign(key: SigningKey, data: bytes) -> bytes:
    return key.sign(data).signature


def verify(public_key: VerifyKey, data: bytes, signature: bytes) -> bool:
    try:
        public_key.verify(data, signature)
        return True
    except BadSignatureError:
        return False
