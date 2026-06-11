import requests
import os
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv

load_dotenv()

# Base URL of the backend worker exposing /events. Override in prod, e.g.
# MERIDIAN_WORKER_API="https://meridian-backend.<your-account>.workers.dev"
WORKER_API = os.environ.get("MERIDIAN_WORKER_API", "http://localhost:8787")


class Source(BaseModel):
    id: int
    name: str


class Event(BaseModel):
    """Matches the /events endpoint after the v1 refactor.

    The backend now stores a cheap per-article *representation* + embedding instead of
    the old rich per-article analysis. The brief stage clusters on the stored `embedding`
    and feeds `content` (the processed article text) to the cluster-analysis prompts.
    """

    id: int
    sourceId: int
    url: str
    title: Optional[str] = None
    publishDate: Optional[datetime] = None
    contentFileKey: Optional[str] = None  # raw RSS payload key (raw_data_r2_key)
    content: Optional[str] = None  # processed article text (content_body_text)
    embeddingText: Optional[str] = None  # structured representation used for the embedding
    wordCount: Optional[int] = None
    embedding: list[float]
    createdAt: Optional[datetime] = None

    @field_validator("publishDate", "createdAt", mode="before")
    @classmethod
    def parse_date(cls, value):
        if value is None:
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            from dateutil import parser

            return parser.parse(value)


def get_events(date: str = None):
    url = f"{WORKER_API}/events"

    if date:
        url += f"?date={date}"

    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {os.environ.get('MERIDIAN_SECRET_KEY')}"},
    )
    response.raise_for_status()
    data = response.json()

    sources = [Source(**source) for source in data["sources"]]
    events = [Event(**event) for event in data["events"]]

    return sources, events
