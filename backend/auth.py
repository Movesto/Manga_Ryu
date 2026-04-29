"""
JWT-based authentication.
Routes are mounted at /api/auth/* via the router included in main.py.
"""
import logging
import os
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Annotated

import bcrypt as _bcrypt

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr

import database

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

_raw_secret = os.getenv("JWT_SECRET")
if not _raw_secret:
    _raw_secret = secrets.token_hex(32)
    logger.warning(
        "JWT_SECRET env var is not set — using a random secret. "
        "All sessions will be invalidated on restart. "
        "Set JWT_SECRET in your environment to persist sessions."
    )
SECRET_KEY     = _raw_secret
ALGORITHM      = "HS256"
ACCESS_EXPIRE  = int(os.getenv("ACCESS_TOKEN_MINUTES", "10080"))  # minutes (7 days default)
REFRESH_EXPIRE = int(os.getenv("REFRESH_TOKEN_DAYS",   "30"))    # days

# ── Rate limiter ──────────────────────────────────────────────────────────────

class _RateLimiter:
    """Simple sliding-window in-memory rate limiter."""
    def __init__(self, max_calls: int, window_s: float):
        self._max    = max_calls
        self._window = window_s
        self._log: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> bool:
        now  = monotonic()
        seen = self._log[key]
        # Evict timestamps outside the window
        self._log[key] = [t for t in seen if now - t < self._window]
        if len(self._log[key]) >= self._max:
            return False
        self._log[key].append(now)
        return True

# 10 attempts per IP per minute on login/register
_login_limiter    = _RateLimiter(max_calls=10, window_s=60)
_register_limiter = _RateLimiter(max_calls=5,  window_s=60)

_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── DB schema ─────────────────────────────────────────────────────────────────

def create_auth_tables():
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id              BIGSERIAL PRIMARY KEY,
                username        TEXT UNIQUE NOT NULL,
                email           TEXT UNIQUE NOT NULL,
                hashed_password TEXT NOT NULL,
                is_active       BOOLEAN DEFAULT TRUE,
                is_admin        BOOLEAN DEFAULT FALSE,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );

            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id          BIGSERIAL PRIMARY KEY,
                user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
                token       TEXT UNIQUE NOT NULL,
                expires_at  TIMESTAMPTZ NOT NULL,
                revoked     BOOLEAN DEFAULT FALSE,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_refresh_token ON refresh_tokens(token);
            CREATE INDEX IF NOT EXISTS idx_refresh_user  ON refresh_tokens(user_id);
            """)
            conn.commit()


def ensure_first_admin():
    """Promotes the earliest registered user to admin if no admin exists yet."""
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users WHERE is_admin = TRUE")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    "UPDATE users SET is_admin = TRUE WHERE id = (SELECT MIN(id) FROM users)"
                )
                conn.commit()

# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RegisterBody(BaseModel):
    username: str
    email:    EmailStr
    password: str

class TokenOut(BaseModel):
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"

class RefreshBody(BaseModel):
    refresh_token: str

class UserOut(BaseModel):
    id:         int
    username:   str
    email:      str
    is_active:  bool
    is_admin:   bool
    created_at: datetime

# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()

def _verify(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())

def _make_access_token(user_id: int, username: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE)
    return jwt.encode(
        {"sub": str(user_id), "username": username, "exp": exp},
        SECRET_KEY, algorithm=ALGORITHM,
    )

def _make_refresh_token(user_id: int) -> str:
    token  = secrets.token_urlsafe(48)
    exp    = datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE)
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (%s, %s, %s)",
                (user_id, token, exp),
            )
            conn.commit()
    return token

def _get_user_by_id(user_id: int) -> dict | None:
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, email, is_active, is_admin, created_at FROM users WHERE id = %s",
                (user_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    cols = ["id", "username", "email", "is_active", "is_admin", "created_at"]
    return dict(zip(cols, row))

# ── Dependency ────────────────────────────────────────────────────────────────

def get_current_user(token: str = Depends(_oauth2)) -> dict:
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub", 0))
        if not user_id:
            raise creds_exc
    except JWTError:
        raise creds_exc

    user = _get_user_by_id(user_id)
    if not user or not user["is_active"]:
        raise creds_exc
    return user

CurrentUser = Annotated[dict, Depends(get_current_user)]


def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


AdminUser = Annotated[dict, Depends(get_admin_user)]

# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterBody, request: Request):
    ip = request.client.host if request.client else "unknown"
    if not _register_limiter.check(ip):
        raise HTTPException(429, "Too many registration attempts. Try again later.")
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if len(body.username) < 2:
        raise HTTPException(400, "Username must be at least 2 characters")

    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM users WHERE username = %s OR email = %s",
                (body.username, body.email),
            )
            if cur.fetchone():
                raise HTTPException(409, "Username or email already taken")

            cur.execute(
                "INSERT INTO users (username, email, hashed_password) VALUES (%s, %s, %s) RETURNING id",
                (body.username, body.email, _hash(body.password)),
            )
            user_id = cur.fetchone()[0]
            conn.commit()

    return TokenOut(
        access_token=_make_access_token(user_id, body.username),
        refresh_token=_make_refresh_token(user_id),
    )


@router.post("/login", response_model=TokenOut)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    ip = request.client.host if request.client else "unknown"
    if not _login_limiter.check(ip):
        raise HTTPException(429, "Too many login attempts. Try again in a minute.")
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, username, hashed_password, is_active FROM users WHERE username = %s",
                (form.username,),
            )
            row = cur.fetchone()

    if not row or not _verify(form.password, row[2]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not row[3]:
        raise HTTPException(403, "Account disabled")

    return TokenOut(
        access_token=_make_access_token(row[0], row[1]),
        refresh_token=_make_refresh_token(row[0]),
    )


@router.post("/refresh", response_model=TokenOut)
def refresh_token(body: RefreshBody):
    now = datetime.now(timezone.utc)
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT rt.user_id, u.username
                FROM refresh_tokens rt
                JOIN users u ON u.id = rt.user_id
                WHERE rt.token = %s AND rt.revoked = FALSE AND rt.expires_at > %s
                """,
                (body.refresh_token, now),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(401, "Invalid or expired refresh token")
            user_id, username = row

            # Rotate: revoke old token, issue new one
            cur.execute(
                "UPDATE refresh_tokens SET revoked = TRUE WHERE token = %s",
                (body.refresh_token,),
            )
            conn.commit()

    return TokenOut(
        access_token=_make_access_token(user_id, username),
        refresh_token=_make_refresh_token(user_id),
    )


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.post("/logout", status_code=204)
def logout(body: RefreshBody):
    with database.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE refresh_tokens SET revoked = TRUE WHERE token = %s",
                (body.refresh_token,),
            )
            conn.commit()
