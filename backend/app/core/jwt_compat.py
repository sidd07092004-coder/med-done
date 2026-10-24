"""JWT compatibility layer.

Works with either PyJWT (module ``jwt``) or python-jose (module ``jose``),
so the app no longer breaks when one of them is missing or when the wrong
``jose`` package is installed.

PyJWT and python-jose expose compatible ``encode`` / ``decode`` APIs for the
HMAC (HS256) use case in this project.
"""

try:  # Preferred: PyJWT (pure Python, no Crypto dependency)
    import jwt as _jwt
    from jwt import PyJWTError as JWTError

    JWT_BACKEND = "pyjwt"
except ImportError:  # Fallback: python-jose
    from jose import jwt as _jwt, JWTError  # type: ignore

    JWT_BACKEND = "python-jose"

jwt = _jwt

__all__ = ["jwt", "JWTError", "JWT_BACKEND"]
