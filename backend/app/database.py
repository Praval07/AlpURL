import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Database URL
DATABASE_URL = "sqlite:///./lilliput.db"

# Engine setup
engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class URLMapping(Base):
    __tablename__ = "url_mappings"

    id = Column(Integer, primary_key=True, index=True)
    short_key = Column(String(10), unique=True, index=True, nullable=False)
    long_url = Column(Text, nullable=False)
    custom_alias = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expiry_date = Column(DateTime, nullable=True)

class ClickTelemetry(Base):
    __tablename__ = "click_telemetry"

    id = Column(Integer, primary_key=True, index=True)
    short_key = Column(String(10), index=True, nullable=False)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    browser = Column(String(50), nullable=True)
    os = Column(String(50), nullable=True)
    device = Column(String(50), nullable=True)
    referrer = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

# Add indexes for fast lookups & analytical queries
Index("ix_click_telemetry_short_key_timestamp", ClickTelemetry.short_key, ClickTelemetry.timestamp)

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
