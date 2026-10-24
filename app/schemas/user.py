from pydantic import BaseModel, ConfigDict, EmailStr
from typing import Optional
from uuid import UUID
from datetime import datetime


class UserBase(BaseModel):
    email: EmailStr
    name: str
    role: str  # admin or volunteer
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class UserInDB(UserBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class UserResponse(UserInDB):
    pass


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: Optional[int] = None          # seconds until expiry
    user: Optional["UserResponse"] = None     # so the client can verify identity immediately


class TokenData(BaseModel):
    user_id: Optional[str] = None


class LoginRequest(BaseModel):
    """JSON login body (alternative to the OAuth2 form-encoded /login)."""
    email: EmailStr
    password: str


class VerifyResponse(BaseModel):
    valid: bool
    user: UserResponse


Token.model_rebuild()
