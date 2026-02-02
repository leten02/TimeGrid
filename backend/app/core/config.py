from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    CORS_ORIGINS: str = "http://localhost:5173"
    GOOGLE_CLIENT_ID: str
    JWT_SECRET: str
    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_SYSTEM_PROMPT: str = "You are TimeGrid AI scheduling assistant. Reply in Korean."

    class Config:
        env_file = ".env"

settings = Settings()
