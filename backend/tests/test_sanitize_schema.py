"""Compatibility alias: the canonical suite lives in test_content_schema.py."""

import pytest

from tests.test_content_schema import *  # noqa: F401,F403

# The canonical file owns the tests; the shim exists only so the contract's
# second filename is present. Skipping the re-collected nodes avoids duplicate
# node IDs (see §2.16 of the spec).
pytestmark = pytest.mark.skip(reason="alias of tests/test_content_schema.py")
