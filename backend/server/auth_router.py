import os
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Request, Response, HTTPException, Depends
from jose import jwt, JWTError
from passlib.context import CryptContext
from pydantic import BaseModel

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-please-set-jwt-secret-env-var")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Injected by app.py after store instantiation
_user_store = None


def set_user_store(store) -> None:
    global _user_store
    _user_store = store


# ── Password helpers ────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT helpers ─────────────────────────────────────────────────────────────

def create_token(user_id: str, email: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "email": email, "role": role, "exp": expire},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def _decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ── FastAPI dependencies ─────────────────────────────────────────────────────

async def get_current_user(request: Request) -> dict[str, Any]:
    # Accept Authorization: Bearer <token> header (cross-origin calls) or cookie
    token: str | None = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.cookies.get("auth_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_token(token)
    return {"user_id": payload["sub"], "email": payload["email"], "role": payload["role"]}


async def require_admin(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Request models ───────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class SeedRequest(BaseModel):
    email: str
    password: str


class CreateUserRequest(BaseModel):
    email: str
    password: str
    role: str = "user"


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginRequest, response: Response):
    user = _user_store.get_user_by_email(body.email)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["user_id"], user["email"], user["role"])
    response.set_cookie(
        key="auth_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=os.getenv("ENV", "development") == "production",
        max_age=60 * 60 * 24 * JWT_EXPIRE_DAYS,
    )
    return {"email": user["email"], "role": user["role"]}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("auth_token")
    return {"message": "Logged out"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/users")
async def create_user(body: CreateUserRequest, _admin: dict = Depends(require_admin)):
    """Create a new user account (admin only)."""
    existing = _user_store.get_user_by_email(body.email)
    if existing:
        raise HTTPException(status_code=409, detail="A user with that email already exists")
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
    hashed = hash_password(body.password)
    user = _user_store.create_user(body.email, hashed, role=body.role)
    return {"message": "User created", "email": user["email"], "role": user["role"]}


@router.get("/users")
async def list_users(_admin: dict = Depends(require_admin)):
    """List all users (admin only)."""
    users = _user_store.list_users()
    return {"users": users}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    """Delete a user (admin only, cannot delete yourself)."""
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    deleted = _user_store.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}


@router.post("/seed")
async def seed(body: SeedRequest):
    """Create the first admin user. Returns 409 once any user exists."""
    if _user_store.count_users() > 0:
        raise HTTPException(status_code=409, detail="Users already exist. Use the app to manage accounts.")
    hashed = hash_password(body.password)
    user = _user_store.create_user(body.email, hashed, role="admin")
    return {"message": "Admin user created", "email": user["email"]}
