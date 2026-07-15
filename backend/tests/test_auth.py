import hashlib
from datetime import datetime, timezone

import jwt
import pytest

import auth


class TestPasswordHashing:
    def test_hash_verify_roundtrip(self):
        hashed = auth._hash("correct horse battery staple")
        assert auth._verify("correct horse battery staple", hashed)

    def test_wrong_password_rejected(self):
        hashed = auth._hash("password123")
        assert not auth._verify("password124", hashed)

    def test_over_72_byte_password_rejected_not_crash(self):
        hashed = auth._hash("short")
        assert auth._verify("x" * 100, hashed) is False

    def test_multibyte_password_over_limit(self):
        # 30 chars × 3 bytes = 90 bytes > 72
        hashed = auth._hash("short")
        assert auth._verify("あ" * 30, hashed) is False


class TestRefreshTokenHashing:
    def test_is_sha256_hex(self):
        token = "some-refresh-token"
        assert auth._hash_refresh(token) == hashlib.sha256(token.encode()).hexdigest()

    def test_distinct_tokens_distinct_hashes(self):
        assert auth._hash_refresh("a") != auth._hash_refresh("b")


class TestAccessToken:
    def test_token_decodes_with_expected_claims(self):
        token = auth._make_access_token(42, "alice")
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        assert payload["sub"] == "42"
        assert payload["username"] == "alice"
        assert payload["exp"] > datetime.now(timezone.utc).timestamp()

    def test_tampered_token_rejected(self):
        token = auth._make_access_token(42, "alice")
        with pytest.raises(jwt.PyJWTError):
            jwt.decode(token + "x", auth.SECRET_KEY, algorithms=[auth.ALGORITHM])

    def test_wrong_secret_rejected(self):
        token = auth._make_access_token(42, "alice")
        with pytest.raises(jwt.PyJWTError):
            jwt.decode(token, "other-secret", algorithms=[auth.ALGORITHM])
