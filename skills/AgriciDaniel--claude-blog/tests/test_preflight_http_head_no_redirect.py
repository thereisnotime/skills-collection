"""Gate 5 _http_head must not follow redirects (VULN-804, v1.9.1).

A draft containing <a href="http://attacker.example/?to=internal-host">
should not turn preflight into an unauthenticated outbound proxy for
the attacker. urllib's default behavior follows 30x redirects; the
no-redirect opener in this fix refuses on the first hop.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PREFLIGHT = ROOT / "scripts" / "blog_preflight.py"


@pytest.fixture(scope="module")
def preflight_module():
    spec = importlib.util.spec_from_file_location("blog_preflight_m", PREFLIGHT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["blog_preflight_m"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_http_head_non_http_scheme_returns_zero(preflight_module):
    """VULN-002 defense-in-depth: file:// / data:// / etc. return 0."""
    for url in (
        "file:///etc/passwd",
        "ftp://example.com/",
        "javascript:alert(1)",
        "data:text/plain;base64,YWJj",
        "",
        "no-scheme",
    ):
        assert preflight_module._http_head(url) == 0, (
            f"expected 0 for non-http(s) URL: {url!r}"
        )


def test_http_head_uses_no_redirect_opener(preflight_module):
    """The opener used for HEAD must refuse redirects."""
    opener = preflight_module._PREFLIGHT_NO_REDIRECT_OPENER
    # Walk the handler chain; one of them must be the no-redirect class.
    handlers = opener.handlers
    refusers = [
        h for h in handlers
        if isinstance(h, preflight_module._PreflightNoRedirectHandler)
    ]
    assert len(refusers) == 1, (
        f"expected exactly one no-redirect handler in the opener, got {len(refusers)}"
    )


def test_no_redirect_handler_returns_none_on_30x(preflight_module):
    """Every 30x method on the handler returns None (= refuse)."""
    handler = preflight_module._PreflightNoRedirectHandler()
    for code, method in (
        (301, "http_error_301"),
        (302, "http_error_302"),
        (303, "http_error_303"),
        (307, "http_error_307"),
        (308, "http_error_308"),
    ):
        result = getattr(handler, method)(None, None, code, "msg", {})
        assert result is None, f"expected None from {method}, got {result!r}"
