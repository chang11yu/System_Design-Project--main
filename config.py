import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATABASE = (BASE_DIR / "coolnoodle.db").as_posix()


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "coolnoodle-local")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{DEFAULT_DATABASE}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
