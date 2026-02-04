from datetime import datetime
from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = None
    estimated_minutes: int | None = Field(default=None, ge=30)
    deadline: datetime
    importance: int | None = Field(default=None, ge=1, le=5)
    priority_tag: str | None = None
    splittable: bool | None = None
    preferred_time: str | None = None
    focus_need: str | None = None
    category: str | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    estimated_minutes: int | None = Field(default=None, ge=30)
    deadline: datetime | None = None
    importance: int | None = Field(default=None, ge=1, le=5)
    priority_tag: str | None = None
    splittable: bool | None = None
    preferred_time: str | None = None
    focus_need: str | None = None
    category: str | None = None
    status: str | None = None


class TaskOut(BaseModel):
    id: str
    title: str
    description: str | None
    estimated_minutes: int
    estimated_by_ai: bool
    deadline: datetime
    importance: int
    priority_tag: str | None
    splittable: bool
    preferred_time: str
    focus_need: str
    category: str | None
    status: str
    created_at: datetime
