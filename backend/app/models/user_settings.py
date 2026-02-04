import uuid
from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class UserSettings(Base):
    __tablename__ = "user_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    week_start_day: Mapped[str] = mapped_column(String(10), nullable=False, default="sunday")
    compact_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    grid_start: Mapped[str] = mapped_column(String(5), nullable=False, default="06:00")
    grid_end: Mapped[str] = mapped_column(String(5), nullable=False, default="23:00")

    scheduling_density: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    preferred_time: Mapped[str] = mapped_column(String(20), nullable=False, default="any")
    auto_schedule: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    focus_duration: Mapped[int] = mapped_column(Integer, nullable=False, default=45)
    break_duration: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    timer_sound: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    task_reminders: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    daily_report: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notify_before: Mapped[int] = mapped_column(Integer, nullable=False, default=10)

    theme: Mapped[str] = mapped_column(String(10), nullable=False, default="light")
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="ko")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


Index("ix_user_settings_user_id", UserSettings.user_id)
