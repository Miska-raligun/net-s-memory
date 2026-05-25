"""Deterministic JSON encoding for objects that get signed and hashed.

We use a strict subset of JSON: dicts (with string keys), lists, strings,
ints, bools, and None. Floats are rejected because their canonical
serialization is fragile across languages — news payloads have no need for
them, and forbidding them removes a class of cross-implementation bugs.

The output is sorted by key (Unicode code point), uses minimal separators,
and escapes non-ASCII to ensure byte-for-byte determinism across Python
versions and platforms.
"""

from __future__ import annotations

import json
from typing import Any

CanonicalValue = dict[str, "CanonicalValue"] | list["CanonicalValue"] | str | int | bool | None


class CanonicalError(TypeError):
    pass


def _check(value: Any, path: str = "$") -> None:
    if isinstance(value, bool) or value is None or isinstance(value, int):
        return
    if isinstance(value, str):
        return
    if isinstance(value, list):
        for i, item in enumerate(value):
            _check(item, f"{path}[{i}]")
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                raise CanonicalError(f"non-string key at {path}: {k!r}")
            _check(v, f"{path}.{k}")
        return
    if isinstance(value, float):
        raise CanonicalError(f"float not allowed at {path}")
    raise CanonicalError(f"unsupported type {type(value).__name__} at {path}")


def encode(value: CanonicalValue) -> bytes:
    _check(value)
    return json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("ascii")
