import pytest

from app.crypto.canonical import CanonicalError, encode


def test_keys_are_sorted() -> None:
    assert encode({"b": 1, "a": 2}) == b'{"a":2,"b":1}'


def test_nested_keys_sorted() -> None:
    assert encode({"x": {"b": 2, "a": 1}}) == b'{"x":{"a":1,"b":2}}'


def test_no_extra_whitespace() -> None:
    assert encode([1, 2, {"a": "b"}]) == b'[1,2,{"a":"b"}]'


def test_unicode_escaped() -> None:
    assert encode({"k": "中文"}) == b'{"k":"\\u4e2d\\u6587"}'


def test_bool_and_none() -> None:
    assert encode({"a": True, "b": False, "c": None}) == b'{"a":true,"b":false,"c":null}'


def test_float_rejected() -> None:
    with pytest.raises(CanonicalError):
        encode({"x": 1.5})


def test_non_string_key_rejected() -> None:
    with pytest.raises(CanonicalError):
        encode({1: "x"})  # type: ignore[dict-item]


def test_unsupported_type_rejected() -> None:
    with pytest.raises(CanonicalError):
        encode({"x": object()})  # type: ignore[dict-item]


def test_deterministic_across_dict_insertion_order() -> None:
    a = {"a": 1, "b": 2, "c": 3}
    b = {"c": 3, "b": 2, "a": 1}
    assert encode(a) == encode(b)
