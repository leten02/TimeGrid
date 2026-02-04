from datetime import datetime
from pydantic import BaseModel, Field

class BlockCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    note: str | None = None
    task_id: str | None = None
    start_at: datetime
    end_at: datetime

class BlockUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    note: str | None = None
    task_id: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None

class BlockOut(BaseModel):
    id: str
    title: str
    note: str | None
    task_id: str | None
    start_at: datetime
    end_at: datetime
