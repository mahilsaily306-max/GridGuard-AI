from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Callable

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.database import database, utc_now


DEMO_ACCOUNTS = (
    ("admin", "GridGuard Admin", "administrator", "Admin@123", "en"),
    ("operator", "Control Room Operator", "operator", "Operator@123", "en"),
    ("lineman1", "Harjit Singh", "lineman", "Lineman@123", "pa"),
    ("lineman2", "Aman Kumar", "lineman", "Lineman@123", "hi"),
    ("supervisor", "Field Supervisor", "supervisor", "Supervisor@123", "en"),
)
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str, salt: bytes | None = None) -> str:
    actual_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), actual_salt, 180_000)
    return f"pbkdf2_sha256$180000${actual_salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_hex, expected = stored.split("$", 3)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


def seed_demo_users() -> None:
    with database() as conn:
        for username, display, role, password, language in DEMO_ACCOUNTS:
            conn.execute(
                """INSERT OR IGNORE INTO users(username,display_name,role,password_hash,language,created_at)
                VALUES(?,?,?,?,?,?)""",
                (username, display, role, hash_password(password), language, utc_now()),
            )


def authenticate(username: str, password: str) -> dict | None:
    with database() as conn:
        user = conn.execute("SELECT * FROM users WHERE username=? AND active=1", (username,)).fetchone()
        if user is None or not verify_password(password, user["password_hash"]):
            return None
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        conn.execute(
            "INSERT INTO auth_sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
            (token, user["id"], now.isoformat(), (now + timedelta(hours=12)).isoformat()),
        )
        public_user = {key: user[key] for key in ("id", "username", "display_name", "role", "language")}
        return {"access_token": token, "token_type": "bearer", "expires_in_seconds": 43200, "user": public_user}


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    with database() as conn:
        row = conn.execute(
            """SELECT u.id,u.username,u.display_name,u.role,u.language,s.expires_at
            FROM auth_sessions s JOIN users u ON u.id=s.user_id
            WHERE s.token=? AND u.active=1""",
            (credentials.credentials,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid session")
        expires = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
        if expires < datetime.now(timezone.utc):
            conn.execute("DELETE FROM auth_sessions WHERE token=?", (credentials.credentials,))
            raise HTTPException(status_code=401, detail="Session expired")
        return {key: row[key] for key in ("id", "username", "display_name", "role", "language")}


def require_roles(*roles: str) -> Callable:
    def dependency(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role permission")
        return user

    return dependency


def audit(
    action: str,
    entity_type: str,
    entity_id: str | int,
    actor: dict | None,
    before: str | None = None,
    after: str | None = None,
) -> None:
    with database() as conn:
        conn.execute(
            """INSERT INTO audit_logs(actor_user_id,actor_label,action,entity_type,entity_id,before_json,after_json,created_at)
            VALUES(?,?,?,?,?,?,?,?)""",
            (
                actor["id"] if actor else None,
                actor["username"] if actor else "public",
                action,
                entity_type,
                str(entity_id),
                before,
                after,
                utc_now(),
            ),
        )
