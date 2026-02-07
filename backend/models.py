"""
SQLAlchemy ORM Models for Music Venue Management System
With Receipt OCR support, Live Chat and Private Messages
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Enum, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from database import Base


class UserRole(str, enum.Enum):
    OWNER = "owner"
    MANAGER = "manager"
    WORKER = "worker"


class StaffPosition(str, enum.Enum):
    """Staff positions at the venue"""
    SWIETLIK = "swietlik"           # Świetlik
    TECHNIK = "technik"             # Technik
    AKUSTYK = "akustyk"             # Akustyk
    BARMAN = "barman"               # Barman
    BARBACK = "barback"             # Barback
    PROMOTOR = "promotor"           # Promotor
    OCHRONA = "ochrona"             # Ochrona
    BRAMKA = "bramka"               # Bramka
    SZATNIA = "szatnia"             # Szatnia
    REZYDENT = "rezydent"           # Rezydent
    SALA = "sala"                   # Sala
    BRAK = "brak"                   # Brak przypisanego stanowiska


# Human-readable labels for positions
POSITION_LABELS = {
    "swietlik": "Świetlik",
    "technik": "Technik",
    "akustyk": "Akustyk",
    "barman": "Barman",
    "barback": "Barback",
    "promotor": "Promotor",
    "ochrona": "Ochrona",
    "bramka": "Bramka",
    "szatnia": "Szatnia",
    "rezydent": "Rezydent",
    "sala": "Sala",
    "brak": "Brak stanowiska"
}


class CostCategory(str, enum.Enum):
    # Bar & Supplies
    BAR_ALCOHOL = "bar_alcohol"
    BAR_BEVERAGES = "bar_beverages"
    BAR_FOOD = "bar_food"
    BAR_SUPPLIES = "bar_supplies"
    # Artists & Performance
    ARTIST_FEE = "artist_fee"
    SOUND_ENGINEER = "sound_engineer"
    LIGHTING = "lighting"
    # Operations
    STAFF_WAGES = "staff_wages"
    SECURITY = "security"
    CLEANING = "cleaning"
    UTILITIES = "utilities"
    RENT = "rent"
    EQUIPMENT = "equipment"
    MARKETING = "marketing"
    FOOD_DRINKS = "food_drinks"
    # Other
    OTHER = "other"


class RevenueSource(str, enum.Enum):
    BOX_OFFICE = "box_office"
    BAR_SALES = "bar_sales"
    MERCHANDISE = "merchandise"
    SPONSORSHIP = "sponsorship"
    OTHER = "other"


class ReceiptStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSED = "processed"
    REJECTED = "rejected"


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(50), default=UserRole.WORKER.value)
    position = Column(String(50), default=StaffPosition.BRAK.value)  # Staff position
    is_active = Column(Boolean, default=True)
    sound_notifications = Column(Boolean, default=True)  # Sound notifications enabled
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships with explicit foreign_keys
    events = relationship("Event", back_populates="created_by_user", foreign_keys="Event.created_by")
    costs = relationship("Cost", back_populates="created_by_user", foreign_keys="Cost.created_by")
    revenues = relationship("Revenue", back_populates="recorded_by_user", foreign_keys="Revenue.recorded_by")
    
    # Receipt relationships - specify foreign_keys to avoid ambiguity
    uploaded_receipts = relationship("Receipt", back_populates="uploader", foreign_keys="Receipt.uploaded_by")
    processed_receipts = relationship("Receipt", back_populates="processor", foreign_keys="Receipt.processed_by")
    
    # Chat relationships
    sent_messages = relationship("ChatMessage", back_populates="sender", foreign_keys="ChatMessage.sender_id")
    
    # Private message relationships
    sent_private_messages = relationship("PrivateMessage", back_populates="sender", foreign_keys="PrivateMessage.sender_id")
    received_private_messages = relationship("PrivateMessage", back_populates="recipient", foreign_keys="PrivateMessage.recipient_id")


class Event(Base):
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    event_date = Column(DateTime, nullable=False)
    venue = Column(String(255), default="Sala Główna")  # Venue/room name
    expected_attendees = Column(Integer, default=0)
    ticket_price = Column(Float, default=0.0)
    status = Column(String(50), default="upcoming")  # upcoming, ongoing, completed, cancelled
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    created_by_user = relationship("User", back_populates="events", foreign_keys=[created_by])
    costs = relationship("Cost", back_populates="event", cascade="all, delete-orphan")
    revenues = relationship("Revenue", back_populates="event", cascade="all, delete-orphan")


class Cost(Base):
    __tablename__ = "costs"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    category = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    description = Column(Text)
    cost_date = Column(DateTime, default=datetime.utcnow)
    receipt_id = Column(Integer, ForeignKey("receipts.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    event = relationship("Event", back_populates="costs")
    created_by_user = relationship("User", back_populates="costs", foreign_keys=[created_by])
    receipt = relationship("Receipt", back_populates="costs")


class Revenue(Base):
    __tablename__ = "revenues"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    source = Column(String(50), nullable=False)
    amount = Column(Float, nullable=False)
    description = Column(Text)
    recorded_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    event = relationship("Event", back_populates="revenues")
    recorded_by_user = relationship("User", back_populates="revenues", foreign_keys=[recorded_by])


class Receipt(Base):
    __tablename__ = "receipts"
    
    id = Column(Integer, primary_key=True, index=True)
    store_name = Column(String(255))
    receipt_date = Column(DateTime)
    total_amount = Column(Float)
    ocr_text = Column(Text)  # Original OCR text
    parsed_items = Column(Text)  # JSON of parsed items
    image_data = Column(Text)  # Base64 encoded image
    image_mime_type = Column(String(50))  # image/jpeg, image/png, etc.
    status = Column(String(50), default=ReceiptStatus.PENDING.value)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    processed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)
    
    # Relationships with explicit foreign_keys
    uploader = relationship("User", back_populates="uploaded_receipts", foreign_keys=[uploaded_by])
    processor = relationship("User", back_populates="processed_receipts", foreign_keys=[processed_by])
    costs = relationship("Cost", back_populates="receipt")


class ChatMessage(Base):
    """Live chat messages - public channel"""
    __tablename__ = "chat_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default="text")  # text, system, announcement
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    sender = relationship("User", back_populates="sent_messages", foreign_keys=[sender_id])


class PrivateMessage(Base):
    """Private messages between two users"""
    __tablename__ = "private_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    sender = relationship("User", back_populates="sent_private_messages", foreign_keys=[sender_id])
    recipient = relationship("User", back_populates="received_private_messages", foreign_keys=[recipient_id])
