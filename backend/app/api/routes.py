import uuid
from datetime import datetime, timezone
import requests

from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from sqlalchemy.orm import Session
from sqlalchemy import select

from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from app.db.session import get_db
from app.core.config import settings
from app.core.security import create_access_token, decode_access_token, COOKIE_NAME
from app.models.user import User
from datetime import datetime
from sqlalchemy import select
from app.models.schedule_block import ScheduleBlock
from app.schemas.schedule_block import BlockCreate, BlockUpdate, BlockOut
from app.schemas.ai import ChatRequest, ChatResponse
router = APIRouter()

@router.get("/health")
def health():
    return {"ok": True}

@router.post("/auth/google")
def auth_google(payload: dict, response: Response, db: Session = Depends(get_db)):
    token = payload.get("id_token")
    if not token:
        raise HTTPException(status_code=400, detail="id_token is required")

    try:
        # 공식 가이드: verify_oauth2_token(token, Request(), WEB_CLIENT_ID) :contentReference[oaicite:5]{index=5}
        idinfo = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="invalid google id_token")

    google_sub = idinfo["sub"]
    email = idinfo.get("email")
    name = idinfo.get("name")
    picture = idinfo.get("picture")

    # upsert (google_sub 기준)
    user = db.execute(select(User).where(User.google_sub == google_sub)).scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if user is None:
        user = User(
            provider="google",
            google_sub=google_sub,
            email=email,
            name=name,
            picture=picture,
            last_login_at=now,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.email = email
        user.name = name
        user.picture = picture
        user.last_login_at = now
        db.commit()

    access = create_access_token(str(user.id), settings.JWT_SECRET)

    # 쿠키 세션: FastAPI Response.set_cookie로 설정 가능 :contentReference[oaicite:6]{index=6}
    response.set_cookie(
        key=COOKIE_NAME,
        value=access,
        httponly=True,
        samesite="lax",
        secure=False,   # 로컬 http라 false
        path="/",
        max_age=60 * 60 * 24 * 7,
    )

    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "picture": user.picture,
        }
    }

def get_current_user(
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, alias=COOKIE_NAME),
):
    if not token:
        raise HTTPException(status_code=401, detail="not authenticated")

    try:
        payload = decode_access_token(token, settings.JWT_SECRET)
        user_id = payload.get("sub")
        uuid.UUID(user_id)  # 형식 검증
    except Exception:
        raise HTTPException(status_code=401, detail="invalid session")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="user not found")
    return user

@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": str(user.id), "email": user.email, "name": user.name, "picture": user.picture}

@router.get("/blocks", response_model=list[BlockOut])
def list_blocks(
    from_: datetime,
    to: datetime,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = (
        select(ScheduleBlock)
        .where(
            ScheduleBlock.user_id == user.id,
            ScheduleBlock.start_at >= from_,
            ScheduleBlock.start_at < to,
        )
        .order_by(ScheduleBlock.start_at.asc())
    )
    blocks = db.execute(stmt).scalars().all()
    return [
        {
            "id": str(b.id),
            "title": b.title,
            "note": b.note,
            "start_at": b.start_at,
            "end_at": b.end_at,
        }
        for b in blocks
    ]


@router.post("/blocks", response_model=BlockOut)
def create_block(
    payload: BlockCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.end_at <= payload.start_at:
        raise HTTPException(status_code=400, detail="end_at must be after start_at")

    block = ScheduleBlock(
        user_id=user.id,
        title=payload.title,
        note=payload.note,
        start_at=payload.start_at,
        end_at=payload.end_at,
    )
    db.add(block)
    db.commit()
    db.refresh(block)
    return {
        "id": str(block.id),
        "title": block.title,
        "note": block.note,
        "start_at": block.start_at,
        "end_at": block.end_at,
    }


@router.patch("/blocks/{block_id}", response_model=BlockOut)
def update_block(
    block_id: str,
    payload: BlockUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # 내 블록만 찾기
    stmt = select(ScheduleBlock).where(ScheduleBlock.id == block_id, ScheduleBlock.user_id == user.id)
    block = db.execute(stmt).scalar_one_or_none()
    if not block:
        raise HTTPException(status_code=404, detail="block not found")

    # 업데이트 적용(부분 업데이트)
    new_title = payload.title if payload.title is not None else block.title
    new_note = payload.note if payload.note is not None else block.note
    new_start = payload.start_at if payload.start_at is not None else block.start_at
    new_end = payload.end_at if payload.end_at is not None else block.end_at

    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="end_at must be after start_at")

    block.title = new_title
    block.note = new_note
    block.start_at = new_start
    block.end_at = new_end

    db.commit()
    db.refresh(block)
    return {
        "id": str(block.id),
        "title": block.title,
        "note": block.note,
        "start_at": block.start_at,
        "end_at": block.end_at,
    }


@router.delete("/blocks/{block_id}")
def delete_block(
    block_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(ScheduleBlock).where(ScheduleBlock.id == block_id, ScheduleBlock.user_id == user.id)
    block = db.execute(stmt).scalar_one_or_none()
    if not block:
        raise HTTPException(status_code=404, detail="block not found")

    db.delete(block)
    db.commit()
    return {"ok": True}

@router.post("/ai/chat", response_model=ChatResponse)
def ai_chat(
    payload: ChatRequest,
    user: User = Depends(get_current_user),
):
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="gemini api key not configured")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent"
    contents = []
    for msg in payload.messages:
        role = "user" if msg.role == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg.text}]})

    body = {"contents": contents}
    if settings.GEMINI_SYSTEM_PROMPT:
        body["system_instruction"] = {"parts": [{"text": settings.GEMINI_SYSTEM_PROMPT}]}

    try:
        resp = requests.post(
            url,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": settings.GEMINI_API_KEY,
            },
            json=body,
            timeout=60,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"gemini request failed: {exc}") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"gemini error: {resp.text}")

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise HTTPException(status_code=502, detail="gemini returned no candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        raise HTTPException(status_code=502, detail="gemini returned empty text")

    return {"reply": text}

@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}
