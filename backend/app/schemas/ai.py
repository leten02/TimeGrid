from datetime import datetime
from pydantic import BaseModel, Field
from typing import Literal


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=4000)


class ChatContext(BaseModel):
    now: datetime | None = None
    tz_offset_minutes: int | None = None
    default_duration_minutes: int | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: ChatContext | None = None


class ChatCreatedBlock(BaseModel):
    id: str
    title: str
    start_at: datetime
    end_at: datetime


class ChatResponse(BaseModel):
    reply: str
    intent: str | None = None
    created_blocks: list[ChatCreatedBlock] = []


class ScheduleTask(BaseModel):
    id: str
    title: str
    estimated_minutes: int
    deadline: datetime
    importance: int
    priority_tag: str | None = None
    splittable: bool | None = None
    preferred_time: str | None = None
    focus_need: str | None = None


class TimeRange(BaseModel):
    start_at: datetime
    end_at: datetime


class BlockedRange(BaseModel):
    date: datetime
    start_min: int
    end_min: int


class SimpleFixedSchedule(BaseModel):
    days: list[int]
    start: str
    end: str


class SimpleBlockedTemplate(BaseModel):
    days: list[int]
    start: str
    end: str


class ScheduleRequest(BaseModel):
    week_start: datetime
    week_end: datetime
    start_hour: int
    end_hour: int
    now: datetime | None = None
    tasks: list[ScheduleTask]
    existing_blocks: list[TimeRange] = []
    fixed_schedules: list[SimpleFixedSchedule] = []
    blocked_templates: list[SimpleBlockedTemplate] = []
    blocked_ranges: list[BlockedRange] = []


class ProposedBlock(BaseModel):
    task_id: str
    title: str
    start_at: datetime
    end_at: datetime


class UnscheduledTask(BaseModel):
    task_id: str
    remaining_minutes: int
    reason: str


class ScheduleResponse(BaseModel):
    proposed_blocks: list[ProposedBlock]
    unscheduled: list[UnscheduledTask]


class RescheduleRequest(BaseModel):
    week_start: datetime
    week_end: datetime
    start_hour: int
    end_hour: int
    now: datetime | None = None
    blocked_ranges: list[BlockedRange] = []


class RescheduleResponse(BaseModel):
    proposed_blocks: list[ProposedBlock]
    unscheduled: list[UnscheduledTask]
    notifications: list[str]
