from pydantic import BaseModel, Field


class BlockedTemplateCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    days: list[int]
    start: str
    end: str
    type: str | None = None


class BlockedTemplateUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    days: list[int] | None = None
    start: str | None = None
    end: str | None = None
    type: str | None = None


class BlockedTemplateOut(BaseModel):
    id: str
    title: str
    days: list[int]
    start: str
    end: str
    type: str | None
