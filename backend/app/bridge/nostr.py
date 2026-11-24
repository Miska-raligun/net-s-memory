"""Build + publish Nostr credibility-attestation events.

These MUST stay byte-compatible with the browser extension's addressing
(extension/src/lib/url.ts + nostr/attestation.ts) so that a seed event the
bridge publishes lands on the same replaceable-event address the extension
queries when a user opens that article. The content JSON only needs to be
parseable by the extension; the URL normalization + "d" tag must match
exactly.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import websockets

from app.bridge.bip340 import pubkey_gen, schnorr_sign

ATTESTATION_KIND = 30909
CONTENT_SCHEMA = "nsm-attestation.v1"

_TRACKING_PREFIXES = ("utm_", "ga_", "yclid", "_hs")
_TRACKING_PARAMS = {
    "fbclid",
    "gclid",
    "dclid",
    "msclkid",
    "spm",
    "ref",
    "ref_src",
    "ref_url",
    "from",
    "source",
    "share_token",
    "scene",
}


def _is_tracking(key: str) -> bool:
    k = key.lower()
    return k in _TRACKING_PARAMS or any(k.startswith(p) for p in _TRACKING_PREFIXES)


def normalize_url(raw: str) -> str:
    """Mirror extension/src/lib/url.ts normalizeUrl."""
    parts = urlsplit(raw)
    if not parts.scheme or not parts.netloc:
        return raw.strip()

    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    netloc = host
    try:
        port = parts.port
    except ValueError:
        port = None
    if port is not None and not (
        (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    ):
        netloc = f"{host}:{port}"

    pairs = parse_qsl(parts.query, keep_blank_values=True)
    kept = [(k, v) for (k, v) in pairs if not _is_tracking(k)]
    kept.sort(key=lambda kv: kv[0])
    query = urlencode(kept)

    path = parts.path or "/"
    out = urlunsplit((scheme, netloc, path, query, ""))
    if out.endswith("/") and urlsplit(out).path != "/":
        out = out[:-1]
    return out


def extract_domain(url: str) -> str | None:
    host = urlsplit(url).hostname
    if not host:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else host


def url_address(normalized_url: str) -> str:
    """Replaceable-event 'd' tag — sha256(normalized_url) first 32 hex chars."""
    return hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()[:32]


def _compact_json(value: object) -> str:
    # Matches JS JSON.stringify: no spaces, non-ASCII left raw (NIP-01).
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_event(
    seckey_hex: str,
    normalized_url: str,
    domain: str,
    content: dict,
    created_at: int,
) -> dict:
    seckey = bytes.fromhex(seckey_hex)
    pubkey = pubkey_gen(seckey).hex()
    tags = [["d", url_address(normalized_url)], ["r", normalized_url], ["t", domain]]
    content_str = _compact_json(content)
    serialized = _compact_json([0, pubkey, created_at, ATTESTATION_KIND, tags, content_str])
    event_id = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    sig = schnorr_sign(bytes.fromhex(event_id), seckey, secrets.token_bytes(32)).hex()
    return {
        "id": event_id,
        "pubkey": pubkey,
        "created_at": created_at,
        "kind": ATTESTATION_KIND,
        "tags": tags,
        "content": content_str,
        "sig": sig,
    }


async def publish_event(relays: list[str], event: dict, timeout: float = 10.0) -> int:
    """Publish to each relay; return how many accepted it (OK …, true)."""
    payload = json.dumps(["EVENT", event])
    accepted = 0
    for relay in relays:
        try:
            async with websockets.connect(relay, open_timeout=timeout, close_timeout=timeout) as ws:
                await ws.send(payload)
                while True:
                    resp = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    msg = json.loads(resp)
                    if isinstance(msg, list) and msg and msg[0] == "OK" and msg[1] == event["id"]:
                        if len(msg) > 2 and msg[2]:
                            accepted += 1
                        break
        except Exception:
            continue
    return accepted
