import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    app_name: str = os.getenv("CLARITYGRID_APP_NAME", "ClarityGrid Backend")
    environment: str = os.getenv("CLARITYGRID_ENVIRONMENT", "development")
    cors_origins: list[str] = [
        origin.strip() for origin in os.getenv("CLARITYGRID_CORS_ORIGINS", "*").split(",") if origin.strip()
    ]
    database_url: str = os.getenv("DATABASE_URL", "")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    applicationinsights_connection_string: str = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "")


settings = Settings()
