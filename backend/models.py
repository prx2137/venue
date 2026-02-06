"""
SQLAlchemy ORM Models for Music Venue Management System
Extended with Receipts and OCR support
"""

from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean, Text, LargeBinary
from sqlalchemy.orm import relationship
from database import Base


class UserRole(str, Enum):
    owner = "owner"
    manager = "manager"
    worker = "worker"


class CostCategory(str, Enum):
    # Bar & Inventory
    bar_alcohol = "bar_alcohol"
    bar_beverages = "bar_beverages"
    bar_food = "bar_food"
    bar_supplies = "bar_supplies"
    
    # Operations
    staff_wages = "staff_wages"
    equipment_rental = "equipment_rental"
    marketing = "marketing"
    utilities = "utilities"
    maintenance = "maintenance"
    cleaning = "cleaning"
    security = "security"
    
    # Artists & Events
    artist_fee = "artist_fee"
    sound_engineer = "sound_engineer"
    lighting = "lighting"
    
    # Other
    licenses = "licenses"
    insurance = "insurance"
    other = "other"


class RevenueSource(str, Enum):
    box_office = "box_office"
    bar_sales = "bar_sales"
    merchandise = "merchandise"
    sponsorship = "sponsorship"
    rental = "rental"
    other = "other"


class ReceiptStatus(str, Enum):
    pending = "pending"           # Uploaded, not processed
    processing = "processing"     # OCR in progress
    processed = "processed"       # OCR complete
    verified = "verified"         # Manually verified
    rejected = "rejected"         # Invalid receipt


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(50), default=UserRole.worker.value)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    events = relationship("Event", back_populates="created_by_user")
    costs = relationship("Cost", back_populates="created_by_user")
    revenues = relationship("Revenue", back_populates="recorded_by_user")
    receipts = relationship("Receipt", back_populates="uploaded_by_user")


class Event(Base):
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    date = Column(DateTime, nullable=False)
    description = Column(Text)
    capacity = Column(Integer)
    ticket_price = Column(Float)
    status = Column(String(50), default="planned")
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    created_by_user = relationship("User", back_populates="events")
    costs = relationship("Cost", back_populates="event", cascade="all, delete-orphan")
    revenues = relationship("Revenue", back_populates="event", cascade="all, delete-orphan")


class Cost(Base):
    __tablename__ = "costs"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=True)  # Nullable for general costs
    category = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    description = Column(Text)
    vendor = Column(String(255))  # Supplier/vendor name
    invoice_number = Column(String(100))  # Invoice/receipt number
    receipt_id = Column(Integer, ForeignKey("receipts.id"), nullable=True)  # Link to receipt
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    cost_date = Column(DateTime, default=datetime.utcnow)  # Actual date of expense
    
    event = relationship("Event", back_populates="costs")
    created_by_user = relationship("User", back_populates="costs")
    receipt = relationship("Receipt", back_populates="costs")


class Receipt(Base):
    """Receipt/Invoice with image and OCR data"""
    __tablename__ = "receipts"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # File info
    filename = Column(String(255), nullable=False)
    content_type = Column(String(100))  # image/jpeg, image/png, application/pdf
    file_data = Column(LargeBinary)  # Store image in DB for simplicity
    file_size = Column(Integer)
    
    # Receipt metadata
    store_name = Column(String(255))  # Detected or manual store name
    receipt_date = Column(DateTime)   # Date on receipt
    receipt_number = Column(String(100))
    total_amount = Column(Float)      # Total from receipt
    currency = Column(String(10), default="PLN")
    
    # OCR data
    status = Column(String(50), default=ReceiptStatus.pending.value)
    ocr_raw_text = Column(Text)       # Raw OCR output
    ocr_items = Column(Text)          # JSON array of detected items
    ocr_confidence = Column(Float)    # OCR confidence score 0-100
    
    # Tracking
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime)
    verified_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime)
    notes = Column(Text)
    
    uploaded_by_user = relationship("User", back_populates="receipts", foreign_keys=[uploaded_by])
    costs = relationship("Cost", back_populates="receipt")


class Revenue(Base):
    __tablename__ = "revenues"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=True)
    source = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    description = Column(Text)
    recorded_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    revenue_date = Column(DateTime, default=datetime.utcnow)
    
    event = relationship("Event", back_populates="revenues")
    recorded_by_user = relationship("User", back_populates="revenues")


class FinancialReport(Base):
    __tablename__ = "financial_reports"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=True)
    report_type = Column(String(50))
    period_from = Column(DateTime)
    period_to = Column(DateTime)
    total_costs = Column(Float)
    total_revenue = Column(Float)
    net_profit = Column(Float)
    generated_at = Column(DateTime, default=datetime.utcnow)
    generated_by = Column(Integer, ForeignKey("users.id"))
