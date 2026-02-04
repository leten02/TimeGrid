from pydantic import BaseModel, Field


class FixedScheduleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    days: list[int]
    start: str
    end: str
    category: str | None = None


class FixedScheduleUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    days: list[int] | None = None
    start: str | None = None
    end: str | None = None
    category: str | None = None


class FixedScheduleOut(BaseModel):
    id: str
    title: str
    days: list[int]
    start: str
    end: str
    category: str | None
