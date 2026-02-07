"""
Database configuration for Music Venue Management System
Supports SQLite (development) and PostgreSQL (production)

IMPORTANT: On Render.com, you MUST set DATABASE_URL environment variable
pointing to PostgreSQL database. SQLite will NOT persist between deploys!
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Get database URL from environment or use SQLite for development
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./venue.db")

# Handle PostgreSQL URL format from Render/Railway
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Detect database type for logging
IS_POSTGRES = DATABASE_URL.startswith("postgresql://")
IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    print("⚠️  WARNING: Using SQLite database - data will NOT persist on Render.com!")
    print("⚠️  Set DATABASE_URL environment variable to use PostgreSQL!")
else:
    print(f"✅ Using PostgreSQL database")

# Create engine with appropriate settings
if IS_SQLITE:
    engine = create_engine(
        DATABASE_URL, 
        connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(
        DATABASE_URL, 
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    """Dependency to get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initialize database tables"""
    from models import User, Event, Cost, Revenue, FinancialReport
    Base.metadata.create_all(bind=engine)
