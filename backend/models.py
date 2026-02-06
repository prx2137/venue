"""
SQLAlchemy Models for Music Venue Management System
Version 4.0 - With Private Messages
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean, ForeignKey, Enum
from sqlalchemy.orm import relationship
from database import Base


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(String(50), default="worker")  # owner, manager, worker
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    events = relationship("Event", back_populates="creator", foreign_keys="Event.created_by")
    revenues = relationship("Revenue", back_populates="creator", foreign_keys="Revenue.created_by")
    costs = relationship("Cost", back_populates="creator", foreign_keys="Cost.created_by")
    receipts = relationship("Receipt", back_populates="uploader", foreign_keys="Receipt.uploaded_by")
    sent_messages = relationship("ChatMessage", back_populates="sender", foreign_keys="ChatMessage.sender_id")
    received_messages = relationship("ChatMessage", back_populates="recipient", foreign_keys="ChatMessage.recipient_id")


class Event(Base):
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    date = Column(DateTime, nullable=False)
    description = Column(Text)
    ticket_price = Column(Float, default=0)
    expected_attendees = Column(Integer, default=0)
    actual_attendees = Column(Integer)
    genre = Column(String(100))
    status = Column(String(50), default="upcoming")  # upcoming, completed, cancelled
    notes = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    creator = relationship("User", back_populates="events", foreign_keys=[created_by])
    revenues = relationship("Revenue", back_populates="event")
    costs = relationship("Cost", back_populates="event")
    staff = relationship("StaffAssignment", back_populates="event")


class Revenue(Base):
    __tablename__ = "revenues"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"))
    description = Column(String(255), nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String(100))  # tickets, bar, merchandise, other
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    event = relationship("Event", back_populates="revenues")
    creator = relationship("User", back_populates="revenues", foreign_keys=[created_by])


class Cost(Base):
    __tablename__ = "costs"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"))
    description = Column(String(255), nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String(100))  # artist_fee, staff, equipment, marketing, bar_stock, other
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    event = relationship("Event", back_populates="costs")
    creator = relationship("User", back_populates="costs", foreign_keys=[created_by])


class StaffAssignment(Base):
    __tablename__ = "staff_assignments"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    position = Column(String(100), nullable=False)  # Barman, Barback, Świetlik, Ochrona, Akustyk, Promotor, Menedżer, Szatnia, Bramka
    name = Column(String(255), nullable=False)
    hours = Column(Float)
    hourly_rate = Column(Float)
    notes = Column(Text)
    
    # Relationships
    event = relationship("Event", back_populates="staff")


class Receipt(Base):
    __tablename__ = "receipts"
    
    id = Column(Integer, primary_key=True, index=True)
    image_data = Column(Text)  # Base64 encoded image
    image_type = Column(String(50))
    ocr_text = Column(Text)
    store_name = Column(String(255))
    total_amount = Column(Float)
    receipt_date = Column(String(50))
    status = Column(String(50), default="pending")  # pending, scanned, processed
    uploaded_by = Column(Integer, ForeignKey("users.id"))
    cost_id = Column(Integer, ForeignKey("costs.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    uploader = relationship("User", back_populates="receipts", foreign_keys=[uploaded_by])


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # NULL = public message
    content = Column(Text, nullable=False)
    is_private = Column(Boolean, default=False)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    sender = relationship("User", back_populates="sent_messages", foreign_keys=[sender_id])
    recipient = relationship("User", back_populates="received_messages", foreign_keys=[recipient_id])
