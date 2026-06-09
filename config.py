import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATABASE = (BASE_DIR / "coolnoodle.db").as_posix()
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DEFAULT_DATABASE}"
)

# Some providers still expose the legacy postgres:// prefix.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "coolnoodle-local")
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True
    }
