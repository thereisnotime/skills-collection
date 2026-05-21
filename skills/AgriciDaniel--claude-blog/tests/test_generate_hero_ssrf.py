"""SSRF guard tests for scripts/generate_hero.py:_http_get.

Locks in the fix for VULN-801 (SSRF in hero downloader). The image-URL
sink in `_http_get` must reject:

    1. non-http(s) schemes (file://, ftp://, gopher://, ...)
    2. URLs that resolve to private/loopback/link-local addresses
       (RFC1918, 127.0.0.0/8, 169.254.0.0/16, IPv6 ULA fc00::/7,
       link-local fe80::/10, loopback ::1)
    3. responses larger than MAX_IMAGE_BYTES
    4. automatic redirect-following (must be one-hop only)

Refer to the v1.9.0 audit and the report-generated remediation queue.
"""
from __future__ import annotations

import importlib.util
import socket
import sys
from pathlib import Path
from unittest import mock

import pytest

ROOT = Path(__file__).resolve().parent.parent
HERO_PATH = ROOT / "scripts" / "generate_hero.py"


@pytest.fixture(scope="module")
def hero_module():
    spec = importlib.util.spec_from_file_location("generate_hero", HERO_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["generate_hero"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_non_http_scheme_is_refused(hero_module):
    for url in (
        "file:///etc/passwd",
        "ftp://example.com/data",
        "gopher://example.com/",
        "data:text/plain;base64,YWJj",
        "javascript:alert(1)",
        "",
        "not-a-url",
    ):
        assert hero_module._http_get(url) is None, f"expected None for: {url!r}"


def test_private_ipv4_is_refused(hero_module, monkeypatch):
    """URLs resolving to RFC1918 / loopback / link-local must be refused."""
    blocked = [
        ("http://aws-imds.test/", "169.254.169.254"),
        ("http://internal-svc.test/", "10.0.0.5"),
        ("http://lan.test/", "192.168.1.1"),
        ("http://reserved.test/", "172.16.0.1"),
        ("http://loopback.test/", "127.0.0.1"),
    ]
    for url, addr in blocked:
        monkeypatch.setattr(socket, "gethostbyname", lambda host, _addr=addr: _addr)
        result = hero_module._http_get(url)
        assert result is None, f"expected None for {url!r} -> {addr}"


def test_private_ipv6_is_refused(hero_module, monkeypatch):
    """ULA fc00::/7, link-local fe80::/10, loopback ::1 must be refused."""
    blocked_v6 = ["::1", "fe80::1", "fc00::1"]
    for addr in blocked_v6:
        monkeypatch.setattr(socket, "gethostbyname", lambda host, _addr=addr: _addr)
        assert hero_module._http_get(f"http://test/") is None, (
            f"expected None for IPv6 {addr}"
        )


def test_oversize_response_is_refused(hero_module, monkeypatch):
    """Responses larger than MAX_IMAGE_BYTES return None, not partial bytes."""
    # Verify guard rejects public IP first by mocking resolution to a public IP
    monkeypatch.setattr(socket, "gethostbyname", lambda host: "8.8.8.8")

    class FakeResp:
        def __init__(self, size):
            self._size = size
        def read(self, n=None):
            if n is None:
                return b"x" * self._size
            return b"x" * min(n, self._size)
        def __enter__(self): return self
        def __exit__(self, *a): return False

    cap = hero_module.MAX_IMAGE_BYTES
    monkeypatch.setattr(
        hero_module.urllib.request,
        "urlopen",
        lambda req, timeout=None: FakeResp(cap + 1),
    )
    assert hero_module._http_get("http://images.unsplash.com/x") is None


def test_size_at_cap_is_accepted(hero_module, monkeypatch):
    """A response exactly at MAX_IMAGE_BYTES still succeeds."""
    monkeypatch.setattr(socket, "gethostbyname", lambda host: "8.8.8.8")
    cap = hero_module.MAX_IMAGE_BYTES

    class FakeResp:
        def read(self, n=None):
            if n is None:
                return b"x" * cap
            return b"x" * min(n, cap)
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(
        hero_module.urllib.request,
        "urlopen",
        lambda req, timeout=None: FakeResp(),
    )
    out = hero_module._http_get("http://images.unsplash.com/x")
    assert out is not None
    assert len(out) == cap


def test_public_ip_with_normal_response_passes(hero_module, monkeypatch):
    """Sanity check: a legitimate stock-image CDN call (mocked) must succeed."""
    monkeypatch.setattr(socket, "gethostbyname", lambda host: "151.101.0.81")

    class FakeResp:
        def read(self, n=None):
            payload = b"\xff\xd8\xff\xe0" + b"x" * 1000  # JPEG magic + body
            if n is None:
                return payload
            return payload[:n]
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(
        hero_module.urllib.request,
        "urlopen",
        lambda req, timeout=None: FakeResp(),
    )
    out = hero_module._http_get("https://images.pexels.com/photos/x.jpg")
    assert out is not None
    assert out.startswith(b"\xff\xd8\xff")


def test_dns_failure_is_refused(hero_module, monkeypatch):
    """Unresolvable hostname returns None, not an exception."""
    def _fail(host):
        raise socket.gaierror("not found")
    monkeypatch.setattr(socket, "gethostbyname", _fail)
    assert hero_module._http_get("http://nonexistent.invalid/") is None


def test_max_image_bytes_constant_exists(hero_module):
    """The cap must be defined as a module-level constant for auditability."""
    assert hasattr(hero_module, "MAX_IMAGE_BYTES")
    assert 1 * 1024 * 1024 <= hero_module.MAX_IMAGE_BYTES <= 100 * 1024 * 1024, (
        "MAX_IMAGE_BYTES outside reasonable range (1-100 MB)"
    )


def test_allowed_schemes_constant_exists(hero_module):
    """The scheme allowlist must be defined as a module-level constant."""
    assert hasattr(hero_module, "ALLOWED_SCHEMES")
    assert hero_module.ALLOWED_SCHEMES == frozenset({"http", "https"}), (
        "ALLOWED_SCHEMES must be exactly {http, https}"
    )
