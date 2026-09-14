"""The local-caller check must fail CLOSED on a forwarded value it cannot parse.

WHY THIS EXISTS. `_is_local_caller` treats any host it cannot parse as an IP as
local:

    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return True

For a DIRECT peer that is correct and deliberate: ASGI test transports report
"testclient" and UDS transports report socket names, and refusing those closes
no hole while breaking 17 existing tests.

For a FORWARDED value it is not. `_real_client_host` substitutes the left-most
X-Forwarded-For entry when the peer is a trusted proxy, so that string arrived
inside a request header. Treating an unparseable one as local let any caller
behind a trusted proxy pass the local check by sending a non-IP token. "unknown"
is a literal some proxies emit when the client address is unavailable, so this
was reachable without an attacker choosing the value.

The existing boundary suite (test_control_local_or_authenticated.py) has 21
tests and the only X-Forwarded-For values in the whole tests/ tree are routable
IPs. Nothing exercised an unparseable forwarded value, which is why this shipped.

The fix threads a `from_forwarded` flag out of `_real_client_host` and fails
closed on it. These assertions pin both halves: the direct-peer leniency that
17 tests depend on MUST stay, and the forwarded path MUST refuse.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dashboard import server  # noqa: E402


class ForwardedHostFailsClosedTests(unittest.TestCase):
    """Each case asserted individually. A count cannot say WHICH one regressed."""

    # ---- the direct-peer leniency that must NOT regress --------------------

    def test_direct_loopback_is_local(self):
        self.assertTrue(server._is_local_caller("127.0.0.1", False))

    def test_direct_ipv6_loopback_is_local(self):
        self.assertTrue(server._is_local_caller("::1", False))

    def test_direct_non_ip_peer_is_local(self):
        # ASGI test transports report "testclient"; UDS transports report names.
        # 17 existing tests depend on this staying True.
        self.assertTrue(server._is_local_caller("testclient", False))

    def test_direct_routable_is_not_local(self):
        # Positive control: without this, every assertion below could pass on a
        # predicate that simply always returns False.
        self.assertFalse(server._is_local_caller("203.0.113.7", False))

    # ---- the forwarded path that must fail CLOSED --------------------------

    def test_forwarded_unparseable_is_not_local(self):
        self.assertFalse(server._is_local_caller("not-an-ip", True))

    def test_forwarded_unknown_token_is_not_local(self):
        # The reachable case: a real proxy sends "unknown" when it cannot
        # determine the client address.
        self.assertFalse(server._is_local_caller("unknown", True))

    def test_forwarded_testclient_is_not_local(self):
        # The same string that is legitimately local as a DIRECT peer must be
        # refused when it arrives through a header.
        self.assertFalse(server._is_local_caller("testclient", True))

    def test_forwarded_routable_is_not_local(self):
        self.assertFalse(server._is_local_caller("203.0.113.7", True))

    def test_forwarded_loopback_is_still_local(self):
        # Negative control for the fix itself: failing closed must not mean
        # refusing everything forwarded. A proxy legitimately reporting a
        # loopback client is still local.
        self.assertTrue(server._is_local_caller("127.0.0.1", True))

    # ---- the producer must report the provenance ---------------------------

    def test_real_client_host_returns_provenance(self):
        """The flag is what makes the distinction possible; pin its shape.

        A regression that dropped the second element would make every call site
        fall back to the default from_forwarded=False, silently restoring the
        fail-open. This asserts the contract rather than the implementation.
        """
        result = server._real_client_host(_FakeRequest(None, {}))
        self.assertIsInstance(result, tuple)
        self.assertEqual(len(result), 2)
        self.assertEqual(result, (None, False))


class _FakeClient:
    def __init__(self, host):
        self.host = host


class _FakeRequest:
    def __init__(self, host, headers):
        self.client = _FakeClient(host) if host is not None else None
        self.headers = headers


if __name__ == "__main__":
    unittest.main()
