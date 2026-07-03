from pydantic import BaseModel, HttpUrl, Field
from typing import Optional, List
from datetime import datetime

class URLShortenRequest(BaseModel):
    long_url: str = Field(..., description="The original long URL to shorten.")
    custom_alias: Optional[str] = Field(None, min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9\-_]+$")
    expiry_hours: Optional[int] = Field(None, ge=1, description="Optional custom expiry duration in hours.")

class URLShortenResponse(BaseModel):
    short_key: str
    short_url: str
    long_url: str
    created_at: datetime
    expiry_date: Optional[datetime]

class ClickStats(BaseModel):
    timestamp: datetime
    ip_address: Optional[str]
    browser: Optional[str]
    os: Optional[str]
    device: Optional[str]
    referrer: Optional[str]

    class Config:
        from_attributes = True

class URLStatsResponse(BaseModel):
    short_key: str
    long_url: str
    created_at: datetime
    clicks_count: int
    clicks: List[ClickStats]
