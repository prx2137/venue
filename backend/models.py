"""
SQLAlchemy ORM Models for Music Venue Management System
Tables: users, events, costs, revenue, financial_reports
"""

from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum

class UserRole(str, enum.Enum):
    OWNER = "owner"
    MANAGER = "manager"
    WORKER = "worker"

class CostCategory(str, enum.Enum):
    SUPPLIES = "supplies"        # Zatowarowanie
    EQUIPMENT = "equipment"      # Sprzęt
    SERVICES = "services"        # Usługi
    PERSONNEL = "personnel"      # Personel
    TRANSPORT = "transport"      # Transport
    OTHER = "other"              # Inne

class RevenueSource(str, enum.Enum):
    BOX_OFFICE = "box_office"    # Utarg z bramki
    BAR = "bar"                  # Utarg z baru
    MERCHANDISE = "merchandise"  # Merchandise
    OTHER = "other"              # Inne

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), default=UserRole.WORKER.value)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    created_events = relationship("Event", back_populates="creator", foreign_keys="Event.created_by")
    created_costs = relationship("Cost", back_populates="creator", foreign_keys="Cost.created_by")
    recorded_revenue = relationship("Revenue", back_populates="recorder", foreign_keys="Revenue.recorded_by")

class Event(Base):
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    date = Column(DateTime(timezone=True), nullable=False)
    capacity = Column(Integer, default=0)
    entry_fee = Column(Float, default=0.0)
    description = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    creator = relationship("User", back_populates="created_events", foreign_keys=[created_by])
    costs = relationship("Cost", back_populates="event", cascade="all, delete-orphan")
    revenues = relationship("Revenue", back_populates="event", cascade="all, delete-orphan")
    reports = relationship("FinancialReport", back_populates="event", cascade="all, delete-orphan")

class Cost(Base):
    __tablename__ = "costs"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    event = relationship("Event", back_populates="costs")
    creator = relationship("User", back_populates="created_costs", foreign_keys=[created_by])

class Revenue(Base):
    __tablename__ = "revenue"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    source = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    recorded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    event = relationship("Event", back_populates="revenues")
    recorder = relationship("User", back_populates="recorded_revenue", foreign_keys=[recorded_by])

class FinancialReport(Base):
    __tablename__ = "financial_reports"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=True)
    total_costs = Column(Float, default=0.0)
    total_revenue = Column(Float, default=0.0)
    net_profit = Column(Float, default=0.0)
    profit_margin = Column(Float, default=0.0)
    period_from = Column(DateTime(timezone=True), nullable=True)
    period_to = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    event = relationship("Event", back_populates="reports")
