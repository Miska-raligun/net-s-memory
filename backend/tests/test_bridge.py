"""Tests for the optional Nostr bridge: URL-normalization parity with the
extension, BIP-340 signing, and event construction. No DB / network."""

from __future__ import annotations

import hashlib
import json

from app.bridge.bip340 import pubkey_gen, schnorr_sign, schnorr_verify
from app.bridge.nostr import (
    ATTESTATION_KIND,
    build_event,
    extract_domain,
    normalize_url,
    url_address,
)


class TestNormalizeUrlParity:
    """Mirrors extension/src/lib/url.test.ts so the two stay in lockstep."""

    def test_lowercases_host_and_drops_fragment(self):
        assert normalize_url("https://Example.COM/a#section") == "https://example.com/a"

    def test_strips_tracking_keeps_real(self):
        assert normalize_url("https://x.com/p?utm_source=a&id=7&fbclid=zz") == "https://x.com/p?id=7"

    def test_sorts_query_params(self):
        assert normalize_url("https://x.com/p?b=2&a=1") == "https://x.com/p?a=1&b=2"

    def test_trailing_slash_path_but_not_origin(self):
        assert normalize_url("https://x.com/a/") == "https://x.com/a"
        assert normalize_url("https://x.com/") == "https://x.com/"

    def test_drops_default_ports(self):
        assert normalize_url("https://x.com:443/a") == "https://x.com/a"

    def test_non_url_unchanged(self):
        assert normalize_url("not a url") == "not a url"

    def test_two_decorated_variants_collide(self):
        a = normalize_url("https://News.Sina.com.cn/x?utm_medium=q&spm=1")
        b = normalize_url("https://news.sina.com.cn/x/?ref=home")
        assert a == b == "https://news.sina.com.cn/x"


class TestExtractDomain:
    def test_lowercase_strip_www(self):
        assert extract_domain("https://www.People.com.cn/x") == "people.com.cn"


class TestUrlAddress:
    def test_stable_and_32_hex(self):
        a = url_address("https://example.com/a")
        assert a == url_address("https://example.com/a")
        assert len(a) == 32
        assert a == hashlib.sha256(b"https://example.com/a").hexdigest()[:32]


class TestBip340:
    def test_known_pubkey_vector(self):
        # BIP-340 test vector 0: seckey = 3
        seckey = bytes.fromhex("0000000000000000000000000000000000000000000000000000000000000003")
        expected = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
        assert pubkey_gen(seckey).hex() == expected

    def test_sign_verify_roundtrip(self):
        seckey = bytes.fromhex("11" * 32)
        msg = hashlib.sha256(b"hello").digest()
        sig = schnorr_sign(msg, seckey, b"\x00" * 32)
        assert schnorr_verify(msg, pubkey_gen(seckey), sig)

    def test_verify_rejects_tampered_message(self):
        seckey = bytes.fromhex("11" * 32)
        sig = schnorr_sign(hashlib.sha256(b"a").digest(), seckey, b"\x00" * 32)
        assert not schnorr_verify(hashlib.sha256(b"b").digest(), pubkey_gen(seckey), sig)


class TestBuildEvent:
    SECKEY = "11" * 32

    def _event(self):
        url = normalize_url("https://example.com/article-7")
        domain = extract_domain(url) or ""
        content = {
            "schema": "nsm-attestation.v1",
            "url": url,
            "domain": domain,
            "score": 82,
            "reputation": {"label": "high", "weight": 0.9},
            "llm": {"score": 80, "consistency": "high", "model": "deepseek-chat"},
            "summary": "测试",
        }
        return url, build_event(self.SECKEY, url, domain, content, 1_700_000_000)

    def test_event_is_well_formed_and_signed(self):
        url, ev = self._event()
        assert ev["kind"] == ATTESTATION_KIND
        # tags address the article the way the extension queries it
        tagmap = {t[0]: t[1] for t in ev["tags"]}
        assert tagmap["d"] == url_address(url)
        assert tagmap["r"] == url
        assert tagmap["t"] == "example.com"
        # id is sha256 of the canonical NIP-01 serialization
        serialized = json.dumps(
            [0, ev["pubkey"], ev["created_at"], ev["kind"], ev["tags"], ev["content"]],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        assert ev["id"] == hashlib.sha256(serialized.encode()).hexdigest()
        # signature verifies against the id
        assert schnorr_verify(
            bytes.fromhex(ev["id"]), bytes.fromhex(ev["pubkey"]), bytes.fromhex(ev["sig"])
        )

    def test_content_parses_with_expected_schema(self):
        _, ev = self._event()
        content = json.loads(ev["content"])
        assert content["schema"] == "nsm-attestation.v1"
        assert content["score"] == 82
        assert content["reputation"]["label"] == "high"
