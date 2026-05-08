from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "dev"

    database_url: str = "postgresql+asyncpg://memory:memory@localhost:5432/memory"
    redis_url: str = "redis://localhost:6379/0"

    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket_snapshots: str = "snapshots"
    minio_secure: bool = False

    service_signing_key_path: str = "./keys/service.ed25519"


settings = Settings()
