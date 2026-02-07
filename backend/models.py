"""
SQLAlchemy ORM Models for Music Venue Management System
With Events, Line-up, Technical Riders, Receipt OCR, Live Chat and Private Messages
"""

from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime
import enum

from database import Base


class UserRole(str, enum.Enum):
    OWNER = "owner"
    MANAGER = "manager"
    WORKER = "worker"


# Default staff positions - created on first run
DEFAULT_POSITIONS = [
    {"code": "swietlik", "name": "Świetlik", "description": "Obsługa oświetlenia"},
    {"code": "technik", "name": "Technik", "description": "Obsługa techniczna"},
    {"code": "akustyk", "name": "Akustyk", "description": "Obsługa nagłośnienia"},
    {"code": "barman", "name": "Barman", "description": "Obsługa baru"},
    {"code": "barback", "name": "Barback", "description": "Pomocnik barmana"},
    {"code": "promotor", "name": "Promotor", "description": "Promocja wydarzeń"},
    {"code": "ochrona", "name": "Ochrona", "description": "Bezpieczeństwo"},
    {"code": "bramka", "name": "Bramka", "description": "Kontrola wejścia"},
    {"code": "szatnia", "name": "Szatnia", "description": "Obsługa szatni"},
    {"code": "rezydent", "name": "Rezydent", "description": "DJ rezydent"},
    {"code": "sala", "name": "Sala", "description": "Obsługa sali"},
]


class StaffPosition(Base):
    """Staff positions stored in database - manageable by admin/manager/owner"""
    __tablename__ = "staff_positions"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(String(255), default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "description": self.description,
            "is_active": self.is_active
        }


class CostCategory(str, enum.Enum):
    BAR_ALCOHOL = "bar_alcohol"
    BAR_BEVERAGES = "bar_beverages"
    BAR_FOOD = "bar_food"
    BAR_SUPPLIES = "bar_supplies"
    ARTIST_FEE = "artist_fee"
    SOUND_ENGINEER = "sound_engineer"
    LIGHTING = "lighting"
    STAFF_WAGES = "staff_wages"
    SECURITY = "security"
    CLEANING = "cleaning"
    UTILITIES = "utilities"
    RENT = "rent"
    EQUIPMENT = "equipment"
    MARKETING = "marketing"
    FOOD_DRINKS = "food_drinks"
    OTHER = "other"


class RevenueSource(str, enum.Enum):
    TICKETS = "tickets"
    BAR = "bar"
    VIP = "vip"
    MERCH = "merch"
    SPONSORSHIP = "sponsorship"
    RENTAL = "rental"
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
    position = Column(String(50), default="brak")
    is_active = Column(Boolean, default=True)
    sound_notifications = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    events = relationship("Event", back_populates="created_by_user", foreign_keys="Event.created_by")
    costs = relationship("Cost", back_populates="created_by_user", foreign_keys="Cost.created_by")
    revenues = relationship("Revenue", back_populates="recorded_by_user", foreign_keys="Revenue.recorded_by")
    uploaded_receipts = relationship("Receipt", back_populates="uploader", foreign_keys="Receipt.uploaded_by")
    processed_receipts = relationship("Receipt", back_populates="processor", foreign_keys="Receipt.processed_by")
    sent_messages = relationship("ChatMessage", back_populates="sender", foreign_keys="ChatMessage.sender_id")
    sent_private_messages = relationship("PrivateMessage", back_populates="sender", foreign_keys="PrivateMessage.sender_id")
    received_private_messages = relationship("PrivateMessage", back_populates="recipient", foreign_keys="PrivateMessage.recipient_id")


class Event(Base):
    """Event model with line-up and technical rider support"""
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    event_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=True)  # Optional end time
    venue = Column(String(255), default="Sala Główna")
    expected_attendees = Column(Integer, default=0)
    ticket_price = Column(Float, default=0.0)
    status = Column(String(50), default="upcoming")  # upcoming, ongoing, completed, cancelled
    color = Column(String(7), default="#3d6a99")  # Calendar color
    
    # Technical rider - written description
    rider_stage1 = Column(Text, nullable=True)  # Equipment for stage 1
    rider_stage2 = Column(Text, nullable=True)  # Equipment for stage 2
    rider_notes = Column(Text, nullable=True)   # Additional rider notes
    
    # Technical rider - uploaded file
    rider_file_data = Column(LargeBinary, nullable=True)  # File content
    rider_file_name = Column(String(255), nullable=True)  # Original filename
    rider_file_type = Column(String(50), nullable=True)   # MIME type (application/pdf, text/plain)
    
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    created_by_user = relationship("User", back_populates="events", foreign_keys=[created_by])
    costs = relationship("Cost", back_populates="event", cascade="all, delete-orphan")
    revenues = relationship("Revenue", back_populates="event", cascade="all, delete-orphan")
    lineup = relationship("LineupEntry", back_populates="event", cascade="all, delete-orphan", order_by="LineupEntry.start_time")


class LineupEntry(Base):
    """Artist/performer entry in event line-up"""
    __tablename__ = "lineup_entries"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    artist_name = Column(String(255), nullable=False)
    stage = Column(String(100), default="Scena główna")  # Which stage
    start_time = Column(DateTime, nullable=False)  # Start time
    end_time = Column(DateTime, nullable=True)     # End time (optional)
    description = Column(Text, nullable=True)      # Set description, genre, etc.
    is_headliner = Column(Boolean, default=False)
    order_index = Column(Integer, default=0)       # For manual ordering
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    event = relationship("Event", back_populates="lineup")


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
    ocr_text = Column(Text)
    parsed_items = Column(Text)
    image_data = Column(Text)  # Base64 encoded
    image_mime_type = Column(String(50))
    status = Column(String(50), default=ReceiptStatus.PENDING.value)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    processed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    processed_at = Column(DateTime, nullable=True)
    
    # Relationships
    uploader = relationship("User", back_populates="uploaded_receipts", foreign_keys=[uploaded_by])
    processor = relationship("User", back_populates="processed_receipts", foreign_keys=[processed_by])
    costs = relationship("Cost", back_populates="receipt")


class ChatMessage(Base):
    """Live chat messages - public channel"""
    __tablename__ = "chat_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default="text")
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
