# Test fixture for tests/test-pytest-gate-timeout.sh.
# Sleeps long enough that a 0.3s timeout will fire but a 15s timeout will not
# (see the paired LOKI_PYTEST_TIMEOUT values in that script; 15s is a pure
# ceiling and costs nothing on the passing path).
import time


def test_sleeping():
    time.sleep(1)
    assert True
