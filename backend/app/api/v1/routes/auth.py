from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token
from app.core.deps import get_db, get_current_user
from app.crud.crud_user import crud_user
from app.models.user import User
from app.schemas.user import Token, UserResponse, LoginRequest, VerifyResponse

router = APIRouter()


def _token_response(user: User) -> dict:
    """Build the login response: JWT + verifiable identity claims + user object.

    The JWT carries `sub` (user id), `email`, `role` and `name` so the token
    itself can be used for verification/authorization, not just as an opaque id.
    """
    expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": str(user.id),
            "email": user.email,
            "role": user.role,
            "name": user.name,
        },
        expires_delta=expires,
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": int(expires.total_seconds()),
        "user": user,
    }


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """OAuth2 password flow (form-encoded). Used by Swagger UI's Authorize button."""
    user = await crud_user.authenticate(db, email=form_data.username, password=form_data.password)
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return _token_response(user)


@router.post("/login/json", response_model=Token)
async def login_json(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    """JSON login body: {"email": "...", "password": "..."}."""
    user = await crud_user.authenticate(db, email=payload.email, password=payload.password)
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return _token_response(user)


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/verify", response_model=VerifyResponse)
async def verify_token(current_user: User = Depends(get_current_user)):
    """Verify the Bearer token in the Authorization header and return its owner.

    Returns `{"valid": true, "user": {...}}` for a valid, active token.
    Returns 401 if the token is missing, malformed, expired, or the user is gone.
    """
    return {"valid": True, "user": current_user}
