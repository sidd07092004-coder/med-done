from datetime import datetime, timedelta
from typing import Optional
from app.core.jwt_compat import JWTError, jwt
from app.core.config import settings

try:
    from bcrypt import hashpw, gensalt, checkpw
except ImportError:
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        from passlib.context import CryptContext
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        return pwd_context.verify(plain_password[:72], hashed_password)


def get_password_hash(password: str) -> str:
    try:
        return hashpw(password.encode('utf-8'), gensalt()).decode('utf-8')
    except Exception:
        from passlib.context import CryptContext
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        return pwd_context.hash(password[:72])


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt
