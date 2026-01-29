from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    CORS_ORIGINS: str = "http://localhost:5173"
    GOOGLE_CLIENT_ID: str
    JWT_SECRET: str

    class Config:
        env_file = ".env"

settings = Settings()
