from datetime import datetime, timedelta, timezone
from jose import jwt

ALGO = "HS256"
COOKIE_NAME = "tg_access"

def create_access_token(user_id: str, secret: str, minutes: int = 60 * 24 * 7) -> str:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=minutes)
    payload = {"sub": user_id, "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
    return jwt.encode(payload, secret, algorithm=ALGO)

def decode_access_token(token: str, secret: str) -> dict:
    return jwt.decode(token, secret, algorithms=[ALGO])
