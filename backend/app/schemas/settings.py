from pydantic import BaseModel, Field


class SettingsOut(BaseModel):
    week_start_day: str
    compact_mode: bool
    grid_start: str
    grid_end: str
    scheduling_density: int
    preferred_time: str
    auto_schedule: bool
    focus_duration: int
    break_duration: int
    timer_sound: bool
    task_reminders: bool
    daily_report: bool
    notify_before: int
    theme: str
    language: str


class SettingsUpdate(BaseModel):
    week_start_day: str | None = None
    compact_mode: bool | None = None
    grid_start: str | None = None
    grid_end: str | None = None
    scheduling_density: int | None = Field(default=None, ge=0, le=100)
    preferred_time: str | None = None
    auto_schedule: bool | None = None
    focus_duration: int | None = None
    break_duration: int | None = None
    timer_sound: bool | None = None
    task_reminders: bool | None = None
    daily_report: bool | None = None
    notify_before: int | None = None
    theme: str | None = None
    language: str | None = None
