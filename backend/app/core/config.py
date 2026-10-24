from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Literal, Optional


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    PROJECT_NAME: str = "Medically Complicated Admin API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    ADMIN_PREFIX: str = "/admin"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/mc_admin"

    # Security
    SECRET_KEY: str = "CHANGE_THIS_IN_PRODUCTION_VERY_SECRET_KEY"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173"]

    # File upload
    UPLOAD_DIR: str = "uploads"
    MEDIA_STORAGE_BACKEND: Literal["local", "sftp"] = "local"
    MEDIA_SFTP_HOST: Optional[str] = None
    MEDIA_SFTP_PORT: int = 22
    MEDIA_SFTP_USERNAME: Optional[str] = None
    MEDIA_SFTP_PRIVATE_KEY: Optional[str] = None
    MEDIA_SFTP_KNOWN_HOSTS: Optional[str] = "~/.ssh/known_hosts"
    MEDIA_SFTP_REMOTE_DIR: str = "/home/aumble/medically_complicated_data/uploads"
    MEDIA_SFTP_CONNECT_TIMEOUT: int = 10
    MAX_UPLOAD_SIZE_MB: int = 10  # legacy cap, retained for backwards compatibility
    ALLOWED_IMAGE_TYPES: List[str] = ["image/jpeg", "image/png", "image/webp", "image/gif"]

    # Per-kind media delivery caps (spec §6.8).
    MAX_IMAGE_UPLOAD_MB: int = 10
    MAX_DOCUMENT_UPLOAD_MB: int = 20
    MAX_AUDIO_UPLOAD_MB: int = 50
    MAX_VIDEO_UPLOAD_MB: int = 200
    MAX_CAPTIONS_UPLOAD_MB: int = 1

    # App settings
    ENVIRONMENT: str = "development"


settings = Settings()
