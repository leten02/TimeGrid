import json
import re
import uuid
from datetime import datetime, timezone, timedelta

import requests
from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from sqlalchemy import select
from sqlalchemy.orm import Session

from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from app.core.config import settings
from app.core.security import create_access_token, decode_access_token, COOKIE_NAME
from app.db.session import get_db
from app.models.user import User
from app.models.schedule_block import ScheduleBlock
from app.models.task import Task
from app.models.fixed_schedule import FixedSchedule
from app.models.blocked_template import BlockedTemplate
from app.models.user_settings import UserSettings
from app.schemas.ai import (
    ChatRequest,
    ChatResponse,
    ScheduleRequest,
    ScheduleResponse,
    RescheduleRequest,
    RescheduleResponse,
)
from app.schemas.schedule_block import BlockCreate, BlockUpdate, BlockOut
from app.schemas.task import TaskCreate, TaskUpdate, TaskOut
from app.schemas.fixed_schedule import FixedScheduleCreate, FixedScheduleUpdate, FixedScheduleOut
from app.schemas.blocked_template import BlockedTemplateCreate, BlockedTemplateUpdate, BlockedTemplateOut
from app.schemas.settings import SettingsOut, SettingsUpdate
router = APIRouter()

DEFAULT_SETTINGS = {
    "week_start_day": "sunday",
    "compact_mode": False,
    "grid_start": "06:00",
    "grid_end": "23:00",
    "scheduling_density": 60,
    "preferred_time": "any",
    "auto_schedule": True,
    "focus_duration": 45,
    "break_duration": 5,
    "timer_sound": True,
    "task_reminders": True,
    "daily_report": False,
    "notify_before": 10,
    "theme": "light",
    "language": "ko",
}

SLOT_MINUTES = 15


PRIORITY_TO_IMPORTANCE = {
    "high": 5,
    "medium": 3,
    "low": 1,
}

IMPORTANCE_TO_PRIORITY = {
    1: "low",
    2: "low",
    3: "medium",
    4: "high",
    5: "high",
}

VALID_PREFERRED = {"morning", "afternoon", "evening", "any"}
VALID_FOCUS = {"high", "medium", "low"}


def clamp_minutes(value: int, min_value: int = 15, max_value: int = 600) -> int:
    return max(min_value, min(max_value, value))


def parse_minutes(text: str | None) -> int | None:
    if not text:
        return None
    match = re.search(r"\d+", text)
    if not match:
        return None
    minutes = int(match.group(0))
    minutes = clamp_minutes(minutes)
    # round to nearest 15 minutes
    minutes = int(round(minutes / 15)) * 15
    return clamp_minutes(minutes)


def estimate_task_minutes(title: str, description: str | None, deadline: datetime | None) -> int | None:
    if not settings.GEMINI_API_KEY:
        return None

    prompt = (
        "You are estimating how long a student task might take. "
        "Return ONLY a single integer number of minutes (multiple of 15), "
        "between 15 and 600. If unsure, return 60."
    )
    detail = f"Task title: {title}\n"
    if description:
        detail += f"Details: {description}\n"
    if deadline:
        detail += f"Deadline: {deadline.isoformat()}\n"
    body = {
        "contents": [
            {"role": "user", "parts": [{"text": f"{prompt}\n\n{detail}"}]},
        ]
    }
    if settings.GEMINI_SYSTEM_PROMPT:
        body["system_instruction"] = {"parts": [{"text": settings.GEMINI_SYSTEM_PROMPT}]}

    try:
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": settings.GEMINI_API_KEY,
            },
            json=body,
            timeout=60,
        )
    except requests.RequestException:
        return None

    if resp.status_code >= 400:
        return None

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        return None

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts).strip()
    return parse_minutes(text)


def minutes_from_start(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def day_index_from_date(target: datetime, week_start: datetime) -> int:
    start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    target_day = target.replace(hour=0, minute=0, second=0, microsecond=0)
    return int((target_day - start).days)


def build_occupied_map(week_start: datetime, start_hour: int, end_hour: int) -> tuple[list[list[bool]], int]:
    slots_per_day = max(1, int(((end_hour - start_hour) * 60) / SLOT_MINUTES))
    occupied = [[False for _ in range(slots_per_day)] for _ in range(7)]
    return occupied, slots_per_day


def mark_range(occupied: list[list[bool]], slots_per_day: int, start_hour: int, day_index: int, start_min: int, end_min: int) -> None:
    if day_index < 0 or day_index >= 7:
        return
    start_slot = max(0, min(slots_per_day, int((start_min - start_hour * 60) / SLOT_MINUTES)))
    end_slot = max(0, min(slots_per_day, int((end_min - start_hour * 60 + SLOT_MINUTES - 1) / SLOT_MINUTES)))
    for i in range(start_slot, end_slot):
        occupied[day_index][i] = True


def mark_past_slots(occupied: list[list[bool]], slots_per_day: int, start_hour: int, week_start: datetime, now: datetime) -> None:
    now_day_index = day_index_from_date(now, week_start)
    for day_index in range(7):
        if day_index < now_day_index:
            for i in range(slots_per_day):
                occupied[day_index][i] = True
        elif day_index == now_day_index:
            now_min = minutes_from_start(now)
            cutoff_slot = max(0, min(slots_per_day, int((now_min - start_hour * 60 + SLOT_MINUTES - 1) / SLOT_MINUTES)))
            for i in range(cutoff_slot):
                occupied[day_index][i] = True


def extract_json(text: str) -> dict | list | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start_candidates = [text.find("{"), text.find("[")]
    start_candidates = [idx for idx in start_candidates if idx != -1]
    if not start_candidates:
        return None
    start_idx = min(start_candidates)
    end_idx = max(text.rfind("}"), text.rfind("]"))
    if end_idx <= start_idx:
        return None
    snippet = text[start_idx : end_idx + 1]
    try:
        return json.loads(snippet)
    except json.JSONDecodeError:
        return None


def rule_based_schedule(request: ScheduleRequest) -> tuple[list[dict], list[dict]]:
    occupied, slots_per_day = build_occupied_map(request.week_start, request.start_hour, request.end_hour)

    # existing blocks
    for block in request.existing_blocks:
        start = block.start_at
        end = block.end_at
        day_index = day_index_from_date(start, request.week_start)
        mark_range(occupied, slots_per_day, request.start_hour, day_index, minutes_from_start(start), minutes_from_start(end))

    # fixed schedules
    for item in request.fixed_schedules:
        for day_index in item.days:
            sh, sm = [int(x) for x in item.start.split(":")]
            eh, em = [int(x) for x in item.end.split(":")]
            mark_range(occupied, slots_per_day, request.start_hour, day_index, sh * 60 + sm, eh * 60 + em)

    # blocked templates
    for item in request.blocked_templates:
        for day_index in item.days:
            sh, sm = [int(x) for x in item.start.split(":")]
            eh, em = [int(x) for x in item.end.split(":")]
            mark_range(occupied, slots_per_day, request.start_hour, day_index, sh * 60 + sm, eh * 60 + em)

    # manual blocked ranges
    for item in request.blocked_ranges:
        day_index = day_index_from_date(item.date, request.week_start)
        mark_range(occupied, slots_per_day, request.start_hour, day_index, item.start_min, item.end_min)

    now = request.now or datetime.now(timezone.utc)
    mark_past_slots(occupied, slots_per_day, request.start_hour, request.week_start, now)

    def deadline_score(deadline: datetime, horizon_days: int = 14) -> float:
        days_left = max(0, int((deadline - now).total_seconds() / 86400))
        return max(0.0, min(1.0, 1 - days_left / horizon_days))

    def importance_score(importance: int) -> float:
        return max(0.0, min(1.0, (importance - 1) / 4))

    ordered = sorted(
        request.tasks,
        key=lambda t: (
            -(1.3 * deadline_score(t.deadline) + importance_score(t.importance)),
            t.deadline,
            -(t.estimated_minutes or 0),
        ),
    )

    preferred_windows = {
        "morning": (9, 12),
        "afternoon": (13, 17),
        "evening": (18, 21),
    }
    focus_chunks = {"high": 90, "medium": 60, "low": 30}

    proposed = []
    unscheduled = []

    for task in ordered:
        total_minutes = task.estimated_minutes
        if total_minutes <= 0:
            unscheduled.append({"task_id": task.id, "remaining_minutes": 0, "reason": "invalid_duration"})
            continue

        chunk_minutes = focus_chunks.get(task.focus_need or "medium", 60)
        chunk_slots = max(1, int(chunk_minutes / SLOT_MINUTES))
        total_slots = max(1, int((total_minutes + SLOT_MINUTES - 1) / SLOT_MINUTES))
        if task.splittable is False:
            chunks = [total_slots]
        else:
            chunks = []
            remaining = total_slots
            while remaining > 0:
                size = chunk_slots if remaining >= chunk_slots else remaining
                chunks.append(size)
                remaining -= size

        preferred_time = task.preferred_time or "any"

        def find_slot(chunk_len: int) -> tuple[int, int] | None:
            day_order = list(range(7))
            for day_index in day_order:
                day = occupied[day_index]
                if preferred_time in preferred_windows:
                    start_h, end_h = preferred_windows[preferred_time]
                    start_slot = max(0, min(slots_per_day, int(((start_h - request.start_hour) * 60) / SLOT_MINUTES)))
                    end_slot = max(start_slot, min(slots_per_day, int(((end_h - request.start_hour) * 60) / SLOT_MINUTES)))
                else:
                    start_slot = 0
                    end_slot = slots_per_day

                for i in range(start_slot, end_slot - chunk_len + 1):
                    if all(not day[i + j] for j in range(chunk_len)):
                        return day_index, i
                if preferred_time in preferred_windows:
                    for i in range(0, slots_per_day - chunk_len + 1):
                        if all(not day[i + j] for j in range(chunk_len)):
                            return day_index, i
            return None

        for chunk_len in chunks:
            placement = find_slot(chunk_len)
            if not placement and chunk_len > 1 and task.splittable is not False:
                placement = find_slot(1)
                if placement:
                    chunk_len = 1
            if not placement:
                unscheduled.append({"task_id": task.id, "remaining_minutes": chunk_len * SLOT_MINUTES, "reason": "no_free_slot"})
                continue

            day_index, start_slot = placement
            for i in range(start_slot, start_slot + chunk_len):
                occupied[day_index][i] = True

            day_date = request.week_start + timedelta(days=day_index)
            start_at = day_date.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=request.start_hour * 60 + start_slot * SLOT_MINUTES)
            end_at = start_at + timedelta(minutes=chunk_len * SLOT_MINUTES)
            proposed.append({
                "task_id": task.id,
                "title": task.title,
                "start_at": start_at,
                "end_at": end_at,
            })

    return proposed, unscheduled


def gemini_schedule(request: ScheduleRequest) -> tuple[list[dict], list[dict]] | None:
    if not settings.GEMINI_API_KEY:
        return None

    occupied, slots_per_day = build_occupied_map(request.week_start, request.start_hour, request.end_hour)

    for block in request.existing_blocks:
        start = block.start_at
        end = block.end_at
        day_index = day_index_from_date(start, request.week_start)
        mark_range(occupied, slots_per_day, request.start_hour, day_index, minutes_from_start(start), minutes_from_start(end))

    for item in request.fixed_schedules:
        for day_index in item.days:
            sh, sm = [int(x) for x in item.start.split(":")]
            eh, em = [int(x) for x in item.end.split(":")]
            mark_range(occupied, slots_per_day, request.start_hour, day_index, sh * 60 + sm, eh * 60 + em)

    for item in request.blocked_templates:
        for day_index in item.days:
            sh, sm = [int(x) for x in item.start.split(":")]
            eh, em = [int(x) for x in item.end.split(":")]
            mark_range(occupied, slots_per_day, request.start_hour, day_index, sh * 60 + sm, eh * 60 + em)

    for item in request.blocked_ranges:
        day_index = day_index_from_date(item.date, request.week_start)
        mark_range(occupied, slots_per_day, request.start_hour, day_index, item.start_min, item.end_min)

    now = request.now or datetime.now(timezone.utc)
    mark_past_slots(occupied, slots_per_day, request.start_hour, request.week_start, now)

    free_ranges = []
    for day_index in range(7):
        day_date = request.week_start + timedelta(days=day_index)
        start_slot = None
        for slot in range(slots_per_day + 1):
            is_free = slot < slots_per_day and not occupied[day_index][slot]
            if is_free and start_slot is None:
                start_slot = slot
            if not is_free and start_slot is not None:
                start_at = day_date.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
                    minutes=request.start_hour * 60 + start_slot * SLOT_MINUTES
                )
                end_at = day_date.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
                    minutes=request.start_hour * 60 + slot * SLOT_MINUTES
                )
                free_ranges.append({
                    "start_at": start_at.isoformat(),
                    "end_at": end_at.isoformat(),
                })
                start_slot = None

    payload = {
        "tasks": [
            {
                "id": task.id,
                "title": task.title,
                "estimated_minutes": task.estimated_minutes,
                "deadline": task.deadline.isoformat(),
                "importance": task.importance,
                "priority_tag": task.priority_tag,
                "splittable": task.splittable,
                "preferred_time": task.preferred_time,
                "focus_need": task.focus_need,
            }
            for task in request.tasks
        ],
        "free_ranges": free_ranges,
        "rules": {
            "slot_minutes": SLOT_MINUTES,
            "avoid_past": True,
        },
    }

    prompt = (
        "You are scheduling tasks into free time ranges. "
        "Return ONLY JSON with a single key 'proposed_blocks'. "
        "Each block must have task_id, title, start_at, end_at. "
        "Times must be ISO-8601, aligned to 15-minute slots. "
        "Only use the provided free_ranges, avoid overlaps, and avoid past times. "
        "If a task is not splittable, place it as one block equal to its duration. "
        "Prefer earlier times for closer deadlines."
    )

    body = {
        "contents": [
            {"role": "user", "parts": [{"text": f"{prompt}\n\n{json.dumps(payload)}"}]},
        ]
    }
    if settings.GEMINI_SYSTEM_PROMPT:
        body["system_instruction"] = {"parts": [{"text": settings.GEMINI_SYSTEM_PROMPT}]}

    try:
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": settings.GEMINI_API_KEY,
            },
            json=body,
            timeout=60,
        )
    except requests.RequestException:
        return None

    if resp.status_code >= 400:
        return None

    data = resp.json()
    candidates = data.get("candidates", [])
    if not candidates:
        return None

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts).strip()
    parsed = extract_json(text)
    if not parsed or "proposed_blocks" not in parsed:
        return None

    proposed = []
    occupied_copy = [row[:] for row in occupied]
    unscheduled_ids = {task.id for task in request.tasks}

    for item in parsed.get("proposed_blocks", []):
        try:
            task_id = item.get("task_id")
            title = item.get("title")
            start_at = datetime.fromisoformat(item.get("start_at"))
            end_at = datetime.fromisoformat(item.get("end_at"))
        except Exception:
            return None

        if not task_id or not title:
            return None
        if start_at >= end_at:
            return None
        if start_at < now:
            return None
        if start_at < request.week_start or end_at > request.week_end:
            return None
        if start_at.minute % SLOT_MINUTES != 0 or end_at.minute % SLOT_MINUTES != 0:
            return None

        day_index = day_index_from_date(start_at, request.week_start)
        start_slot = int((minutes_from_start(start_at) - request.start_hour * 60) / SLOT_MINUTES)
        end_slot = int((minutes_from_start(end_at) - request.start_hour * 60) / SLOT_MINUTES)
        if day_index < 0 or day_index >= 7 or start_slot < 0 or end_slot > slots_per_day:
            return None
        if any(occupied_copy[day_index][i] for i in range(start_slot, end_slot)):
            return None

        for i in range(start_slot, end_slot):
            occupied_copy[day_index][i] = True

        proposed.append({
            "task_id": task_id,
            "title": title,
            "start_at": start_at,
            "end_at": end_at,
        })
        unscheduled_ids.discard(task_id)

    unscheduled = [
        {"task_id": task_id, "remaining_minutes": 0, "reason": "not_scheduled_by_ai"}
        for task_id in unscheduled_ids
    ]

    return proposed, unscheduled


def serialize_settings(row: UserSettings) -> dict:
    return {
        "week_start_day": row.week_start_day,
        "compact_mode": row.compact_mode,
        "grid_start": row.grid_start,
        "grid_end": row.grid_end,
        "scheduling_density": row.scheduling_density,
        "preferred_time": row.preferred_time,
        "auto_schedule": row.auto_schedule,
        "focus_duration": row.focus_duration,
        "break_duration": row.break_duration,
        "timer_sound": row.timer_sound,
        "task_reminders": row.task_reminders,
        "daily_report": row.daily_report,
        "notify_before": row.notify_before,
        "theme": row.theme,
        "language": row.language,
    }


def get_or_create_settings(db: Session, user: User) -> UserSettings:
    stmt = select(UserSettings).where(UserSettings.user_id == user.id)
    row = db.execute(stmt).scalar_one_or_none()
    if row:
        if row.focus_duration == 25:
            row.focus_duration = DEFAULT_SETTINGS["focus_duration"]
            db.commit()
            db.refresh(row)
        return row
    row = UserSettings(user_id=user.id, **DEFAULT_SETTINGS)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def serialize_task(row: Task) -> dict:
    return {
        "id": str(row.id),
        "title": row.title,
        "description": row.description,
        "estimated_minutes": row.estimated_minutes,
        "estimated_by_ai": row.estimated_by_ai,
        "deadline": row.deadline,
        "importance": row.importance,
        "priority_tag": row.priority_tag,
        "splittable": row.splittable,
        "preferred_time": row.preferred_time,
        "focus_need": row.focus_need,
        "category": row.category,
        "status": row.status,
        "created_at": row.created_at,
    }


def serialize_fixed_schedule(row: FixedSchedule) -> dict:
    return {
        "id": str(row.id),
        "title": row.title,
        "days": row.days,
        "start": row.start_time,
        "end": row.end_time,
        "category": row.category,
    }


def serialize_blocked_template(row: BlockedTemplate) -> dict:
    return {
        "id": str(row.id),
        "title": row.title,
        "days": row.days,
        "start": row.start_time,
        "end": row.end_time,
        "type": row.block_type,
    }

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


@router.get("/settings", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = get_or_create_settings(db, user)
    return serialize_settings(row)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = get_or_create_settings(db, user)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return serialize_settings(row)


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = (
        select(Task)
        .where(Task.user_id == user.id)
        .order_by(Task.created_at.desc())
    )
    rows = db.execute(stmt).scalars().all()
    return [serialize_task(row) for row in rows]


@router.post("/tasks", response_model=TaskOut)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    priority_tag = payload.priority_tag if payload.priority_tag in PRIORITY_TO_IMPORTANCE else None
    importance = payload.importance
    if importance is None:
        importance = PRIORITY_TO_IMPORTANCE.get(priority_tag, 3)
    if priority_tag is None:
        priority_tag = IMPORTANCE_TO_PRIORITY.get(int(importance), "medium")

    preferred_time = payload.preferred_time if payload.preferred_time in VALID_PREFERRED else "any"
    focus_need = payload.focus_need if payload.focus_need in VALID_FOCUS else "medium"
    splittable = payload.splittable if payload.splittable is not None else True

    estimated_minutes = payload.estimated_minutes
    estimated_by_ai = False
    if estimated_minutes is None:
        estimated_minutes = estimate_task_minutes(payload.title, payload.description, payload.deadline)
        if estimated_minutes is not None:
            estimated_by_ai = True
    if estimated_minutes is None:
        estimated_minutes = 60

    task = Task(
        user_id=user.id,
        title=payload.title,
        description=payload.description,
        estimated_minutes=estimated_minutes,
        estimated_by_ai=estimated_by_ai,
        deadline=payload.deadline,
        importance=importance,
        priority_tag=priority_tag,
        splittable=splittable,
        preferred_time=preferred_time,
        focus_need=focus_need,
        category=payload.category,
        status="pending",
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return serialize_task(task)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: str,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Task).where(Task.id == task_id, Task.user_id == user.id)
    task = db.execute(stmt).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="task not found")

    updates = payload.model_dump(exclude_unset=True)
    if "priority_tag" in updates:
        tag = updates.get("priority_tag")
        if tag not in PRIORITY_TO_IMPORTANCE:
            updates["priority_tag"] = None
        else:
            updates["importance"] = PRIORITY_TO_IMPORTANCE[tag]

    if "preferred_time" in updates and updates.get("preferred_time") not in VALID_PREFERRED:
        updates["preferred_time"] = "any"
    if "focus_need" in updates and updates.get("focus_need") not in VALID_FOCUS:
        updates["focus_need"] = "medium"

    if "estimated_minutes" in updates and updates.get("estimated_minutes") is not None:
        updates["estimated_by_ai"] = False

    for key, value in updates.items():
        setattr(task, key, value)
    db.commit()
    db.refresh(task)
    return serialize_task(task)


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Task).where(Task.id == task_id, Task.user_id == user.id)
    task = db.execute(stmt).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}


@router.get("/fixed-schedules", response_model=list[FixedScheduleOut])
def list_fixed_schedules(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(FixedSchedule).where(FixedSchedule.user_id == user.id).order_by(FixedSchedule.created_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [serialize_fixed_schedule(row) for row in rows]


@router.post("/fixed-schedules", response_model=FixedScheduleOut)
def create_fixed_schedule(
    payload: FixedScheduleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = FixedSchedule(
        user_id=user.id,
        title=payload.title,
        days=payload.days,
        start_time=payload.start,
        end_time=payload.end,
        category=payload.category,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_fixed_schedule(row)


@router.patch("/fixed-schedules/{schedule_id}", response_model=FixedScheduleOut)
def update_fixed_schedule(
    schedule_id: str,
    payload: FixedScheduleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(FixedSchedule).where(FixedSchedule.id == schedule_id, FixedSchedule.user_id == user.id)
    row = db.execute(stmt).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="fixed schedule not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "start":
            row.start_time = value
        elif key == "end":
            row.end_time = value
        else:
            setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return serialize_fixed_schedule(row)


@router.delete("/fixed-schedules/{schedule_id}")
def delete_fixed_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(FixedSchedule).where(FixedSchedule.id == schedule_id, FixedSchedule.user_id == user.id)
    row = db.execute(stmt).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="fixed schedule not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/blocked-templates", response_model=list[BlockedTemplateOut])
def list_blocked_templates(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(BlockedTemplate).where(BlockedTemplate.user_id == user.id).order_by(BlockedTemplate.created_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [serialize_blocked_template(row) for row in rows]


@router.post("/blocked-templates", response_model=BlockedTemplateOut)
def create_blocked_template(
    payload: BlockedTemplateCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = BlockedTemplate(
        user_id=user.id,
        title=payload.title,
        days=payload.days,
        start_time=payload.start,
        end_time=payload.end,
        block_type=payload.type,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_blocked_template(row)


@router.patch("/blocked-templates/{template_id}", response_model=BlockedTemplateOut)
def update_blocked_template(
    template_id: str,
    payload: BlockedTemplateUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(BlockedTemplate).where(BlockedTemplate.id == template_id, BlockedTemplate.user_id == user.id)
    row = db.execute(stmt).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="blocked template not found")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "start":
            row.start_time = value
        elif key == "end":
            row.end_time = value
        elif key == "type":
            row.block_type = value
        else:
            setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return serialize_blocked_template(row)


@router.delete("/blocked-templates/{template_id}")
def delete_blocked_template(
    template_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(BlockedTemplate).where(BlockedTemplate.id == template_id, BlockedTemplate.user_id == user.id)
    row = db.execute(stmt).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="blocked template not found")
    db.delete(row)
    db.commit()
    return {"ok": True}

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
            "task_id": str(b.task_id) if b.task_id else None,
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
        task_id=payload.task_id,
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
        "task_id": str(block.task_id) if block.task_id else None,
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
    new_task_id = payload.task_id if payload.task_id is not None else block.task_id

    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="end_at must be after start_at")

    block.title = new_title
    block.note = new_note
    block.start_at = new_start
    block.end_at = new_end
    block.task_id = new_task_id

    db.commit()
    db.refresh(block)
    return {
        "id": str(block.id),
        "title": block.title,
        "note": block.note,
        "task_id": str(block.task_id) if block.task_id else None,
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

def _gemini_generate_text(body: dict) -> str:
    resp = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent",
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": settings.GEMINI_API_KEY,
        },
        json=body,
        timeout=60,
    )

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
    return text


def _format_korean_datetime(dt: datetime) -> str:
    hour = dt.hour
    minute = dt.minute
    ampm = "오전" if hour < 12 else "오후"
    display_hour = hour % 12
    if display_hour == 0:
        display_hour = 12
    if minute == 0:
        time_str = f"{display_hour}시"
    else:
        time_str = f"{display_hour}:{str(minute).zfill(2)}"
    return f"{dt.month}월 {dt.day}일 {ampm} {time_str}"


@router.post("/ai/chat", response_model=ChatResponse)
def ai_chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="gemini api key not configured")

    context = payload.context
    now_utc = context.now if context and context.now else datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    tz_offset = context.tz_offset_minutes if context and context.tz_offset_minutes is not None else 0
    local_tz = timezone(timedelta(minutes=-tz_offset))
    now_local = now_utc.astimezone(local_tz)
    default_duration = context.default_duration_minutes if context and context.default_duration_minutes else 60

    messages_payload = [{"role": msg.role, "text": msg.text} for msg in payload.messages]

    structured_prompt = (
        "You are TimeGrid scheduling assistant. Return ONLY JSON.\n"
        "Output shape:\n"
        "{\n"
        '  "intent": "create_event" | "clarify" | "chat",\n'
        '  "reply": "Korean reply to user",\n'
        '  "events": [\n'
        "    {\n"
        '      "title": "string",\n'
        '      "date": "YYYY-MM-DD",\n'
        '      "start_time": "HH:MM",\n'
        '      "end_time": "HH:MM",\n'
        '      "duration_minutes": number,\n'
        '      "note": "string"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- If user asks to add/schedule events, intent=create_event and fill events array.\n"
        "- Use 24h time. If end_time is missing, include duration_minutes (default "
        f"{default_duration}"
        ").\n"
        "- If date is missing, choose the closest future date based on current local datetime.\n"
        "- If time is missing/ambiguous or in the past, intent=clarify and reply asking for details.\n"
        "- If not a scheduling request, intent=chat and events=[] or omit.\n"
        "- Always respond in Korean in reply.\n"
        f"Current local datetime: {now_local.isoformat()}\n"
        f"Timezone offset minutes: {tz_offset}\n"
        f"Messages: {json.dumps(messages_payload, ensure_ascii=False)}"
    )

    body = {
        "contents": [
            {"role": "user", "parts": [{"text": structured_prompt}]},
        ]
    }
    if settings.GEMINI_SYSTEM_PROMPT:
        body["system_instruction"] = {"parts": [{"text": settings.GEMINI_SYSTEM_PROMPT}]}

    try:
        text = _gemini_generate_text(body)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"gemini request failed: {exc}") from exc

    parsed = extract_json(text)
    if not isinstance(parsed, dict) or "reply" not in parsed:
        # fallback to plain chat
        contents = []
        for msg in payload.messages:
            role = "user" if msg.role == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg.text}]})
        fallback_body = {"contents": contents}
        if settings.GEMINI_SYSTEM_PROMPT:
            fallback_body["system_instruction"] = {"parts": [{"text": settings.GEMINI_SYSTEM_PROMPT}]}
        try:
            reply_text = _gemini_generate_text(fallback_body)
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"gemini request failed: {exc}") from exc
        return {"reply": reply_text, "intent": "chat", "created_blocks": []}

    intent = parsed.get("intent") or "chat"
    reply = parsed.get("reply") or "알겠습니다."
    created_blocks = []

    if intent == "create_event":
        events = parsed.get("events")
        if not isinstance(events, list):
            single = parsed.get("event")
            events = [single] if isinstance(single, dict) else []

        if not events:
            return {"reply": "추가할 일정의 날짜와 시간을 알려주세요.", "intent": "clarify", "created_blocks": []}

        def normalize_time(t: str) -> str:
            parts = t.split(":")
            if len(parts) == 1:
                return f"{parts[0].zfill(2)}:00:00"
            if len(parts) == 2:
                return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:00"
            return t

        created_blocks = []
        failed_count = 0

        for event in events:
            if not isinstance(event, dict):
                failed_count += 1
                continue
            title = (event.get("title") or "").strip() or "새 일정"
            date_str = event.get("date")
            start_time = event.get("start_time")
            end_time = event.get("end_time")
            duration_minutes = event.get("duration_minutes") or default_duration
            try:
                duration_minutes = int(duration_minutes)
            except (TypeError, ValueError):
                duration_minutes = default_duration
            note = (event.get("note") or "").strip() or None

            if not date_str or not start_time:
                failed_count += 1
                continue

            try:
                start_local = datetime.fromisoformat(f"{date_str}T{normalize_time(start_time)}").replace(tzinfo=local_tz)
            except Exception:
                failed_count += 1
                continue

            if end_time:
                try:
                    end_local = datetime.fromisoformat(f"{date_str}T{normalize_time(end_time)}").replace(tzinfo=local_tz)
                except Exception:
                    end_local = start_local + timedelta(minutes=duration_minutes)
            else:
                end_local = start_local + timedelta(minutes=duration_minutes)

            if end_local <= start_local:
                end_local = end_local + timedelta(days=1)

            start_utc = start_local.astimezone(timezone.utc)
            end_utc = end_local.astimezone(timezone.utc)

            if start_utc < now_utc:
                failed_count += 1
                continue

            block = ScheduleBlock(
                user_id=user.id,
                title=title,
                note=note,
                start_at=start_utc,
                end_at=end_utc,
            )
            db.add(block)
            db.flush()

            created_blocks.append(
                {
                    "id": str(block.id),
                    "title": block.title,
                    "start_at": block.start_at,
                    "end_at": block.end_at,
                }
            )

        if created_blocks:
            db.commit()
        else:
            db.rollback()

        if not created_blocks:
            return {"reply": "날짜와 시간을 다시 알려주세요.", "intent": "clarify", "created_blocks": []}

        if failed_count > 0:
            reply = f"총 {len(created_blocks)}개 일정은 추가했어요. 나머지는 정보가 부족해 추가하지 못했어요."
        else:
            reply = f"네, {len(created_blocks)}개의 일정을 추가해 드렸어요."

    return {"reply": reply, "intent": intent, "created_blocks": created_blocks}


@router.post("/ai/schedule", response_model=ScheduleResponse)
def ai_schedule(
    payload: ScheduleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not payload.tasks:
        return {"proposed_blocks": [], "unscheduled": []}

    task_ids = [uuid.UUID(task.id) for task in payload.tasks]
    rows = db.execute(
        select(Task).where(Task.user_id == user.id, Task.id.in_(task_ids))
    ).scalars().all()
    tasks = [
        {
            "id": str(row.id),
            "title": row.title,
            "estimated_minutes": row.estimated_minutes,
            "deadline": row.deadline,
            "importance": row.importance,
            "priority_tag": row.priority_tag,
            "splittable": row.splittable,
            "preferred_time": row.preferred_time,
            "focus_need": row.focus_need,
        }
        for row in rows
    ]

    if not tasks:
        return {"proposed_blocks": [], "unscheduled": []}

    schedule_request = ScheduleRequest(
        **payload.model_dump(exclude={"tasks"}),
        tasks=tasks,
    )

    result = gemini_schedule(schedule_request)
    if result is None:
        proposed, unscheduled = rule_based_schedule(schedule_request)
    else:
        proposed, unscheduled = result

    return {
        "proposed_blocks": proposed,
        "unscheduled": unscheduled,
    }


@router.post("/ai/reschedule", response_model=RescheduleResponse)
def ai_reschedule(
    payload: RescheduleRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = payload.now or datetime.now(timezone.utc)

    tasks = db.execute(
        select(Task).where(Task.user_id == user.id, Task.status != "done")
    ).scalars().all()
    if not tasks:
        return {"proposed_blocks": [], "unscheduled": [], "notifications": []}

    blocks = db.execute(
        select(ScheduleBlock).where(
            ScheduleBlock.user_id == user.id,
            ScheduleBlock.start_at >= payload.week_start,
            ScheduleBlock.start_at < payload.week_end,
        )
    ).scalars().all()

    fixed = db.execute(
        select(FixedSchedule).where(FixedSchedule.user_id == user.id)
    ).scalars().all()
    blocked = db.execute(
        select(BlockedTemplate).where(BlockedTemplate.user_id == user.id)
    ).scalars().all()

    overdue_tasks = []
    notifications = []

    for task in tasks:
        task_blocks = [b for b in blocks if b.task_id == task.id]
        if any(b.end_at >= now for b in task_blocks):
            continue
        past_minutes = sum(
            max(0, int((b.end_at - b.start_at).total_seconds() / 60)) for b in task_blocks if b.end_at < now
        )
        remaining = max(0, task.estimated_minutes - past_minutes)
        if remaining <= 0:
            continue
        overdue_tasks.append(
            {
                "id": str(task.id),
                "title": task.title,
                "estimated_minutes": remaining,
                "deadline": task.deadline,
                "importance": task.importance,
                "priority_tag": task.priority_tag,
                "splittable": task.splittable,
                "preferred_time": task.preferred_time,
                "focus_need": task.focus_need,
            }
        )

    if not overdue_tasks:
        return {"proposed_blocks": [], "unscheduled": [], "notifications": []}

    schedule_request = ScheduleRequest(
        week_start=payload.week_start,
        week_end=payload.week_end,
        start_hour=payload.start_hour,
        end_hour=payload.end_hour,
        now=now,
        tasks=overdue_tasks,
        existing_blocks=[
            {"start_at": b.start_at, "end_at": b.end_at} for b in blocks
        ],
        fixed_schedules=[
            {"days": f.days, "start": f.start_time, "end": f.end_time} for f in fixed
        ],
        blocked_templates=[
            {"days": t.days, "start": t.start_time, "end": t.end_time} for t in blocked
        ],
        blocked_ranges=payload.blocked_ranges,
    )

    result = gemini_schedule(schedule_request)
    if result is None:
        proposed, unscheduled = rule_based_schedule(schedule_request)
    else:
        proposed, unscheduled = result

    for block in proposed:
        new_block = ScheduleBlock(
            user_id=user.id,
            task_id=uuid.UUID(block["task_id"]),
            title=block["title"],
            note="AI 재배치",
            start_at=block["start_at"],
            end_at=block["end_at"],
        )
        db.add(new_block)
        notifications.append(f"'{block['title']}' 태스크가 자동 재배치되었습니다.")

    db.commit()

    return {
        "proposed_blocks": proposed,
        "unscheduled": unscheduled,
        "notifications": notifications,
    }

@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}
