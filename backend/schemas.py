"""
Pydantic Schemas for Music Venue Management System
With Events, Line-up, Technical Riders, Receipt OCR
"""

from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List
from datetime import datetime
from enum import Enum


# ==================== ENUMS ====================

class UserRole(str, Enum):
    OWNER = "owner"
    MANAGER = "manager"
    WORKER = "worker"


class CostCategory(str, Enum):
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


class RevenueSource(str, Enum):
    TICKETS = "tickets"
    BAR = "bar"
    VIP = "vip"
    MERCH = "merch"
    SPONSORSHIP = "sponsorship"
    RENTAL = "rental"
    OTHER = "other"


class ReceiptStatus(str, Enum):
    PENDING = "pending"
    PROCESSED = "processed"
    REJECTED = "rejected"


# ==================== STAFF POSITIONS ====================

class StaffPositionCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = ""
    
    @field_validator('code')
    @classmethod
    def code_valid(cls, v):
        if not v or not v.strip():
            raise ValueError('Kod stanowiska jest wymagany')
        # Only alphanumeric and underscore
        clean = v.strip().lower().replace(' ', '_')
        return clean
    
    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Nazwa stanowiska jest wymagana')
        return v.strip()


class StaffPositionUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class StaffPositionResponse(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str]
    is_active: bool
    
    model_config = {"from_attributes": True}


# ==================== AUTH ====================

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


# ==================== USERS ====================

class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    
    @field_validator('password')
    @classmethod
    def password_strong(cls, v):
        if len(v) < 6:
            raise ValueError('Hasło musi mieć min. 6 znaków')
        return v
    
    @field_validator('full_name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Imię i nazwisko jest wymagane')
        return v.strip()


class UserCreate(BaseModel):
    """Schema for managers/owners to create users"""
    email: EmailStr
    password: str
    full_name: str
    role: UserRole = UserRole.WORKER
    position: Optional[str] = "brak"
    
    @field_validator('password')
    @classmethod
    def password_strong(cls, v):
        if len(v) < 6:
            raise ValueError('Hasło musi mieć min. 6 znaków')
        return v


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
    position: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    position: Optional[str] = "brak"
    is_active: bool
    sound_notifications: Optional[bool] = True
    created_at: datetime
    
    model_config = {"from_attributes": True}


class PositionUpdate(BaseModel):
    position: str


class SoundNotificationUpdate(BaseModel):
    enabled: bool


# ==================== LINE-UP ====================

class LineupEntryCreate(BaseModel):
    artist_name: str
    stage: str = "Scena główna"
    start_time: datetime
    end_time: Optional[datetime] = None
    description: Optional[str] = None
    is_headliner: bool = False
    order_index: int = 0
    
    @field_validator('artist_name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Nazwa artysty jest wymagana')
        return v.strip()


class LineupEntryUpdate(BaseModel):
    artist_name: Optional[str] = None
    stage: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    description: Optional[str] = None
    is_headliner: Optional[bool] = None
    order_index: Optional[int] = None


class LineupEntryResponse(BaseModel):
    id: int
    event_id: int
    artist_name: str
    stage: str
    start_time: datetime
    end_time: Optional[datetime]
    description: Optional[str]
    is_headliner: bool
    order_index: int
    created_at: datetime
    
    model_config = {"from_attributes": True}


# ==================== EVENTS ====================

class EventCreate(BaseModel):
    name: str
    description: Optional[str] = None
    event_date: datetime
    end_date: Optional[datetime] = None
    venue: str = "Sala Główna"
    expected_attendees: int = 0
    ticket_price: float = 0.0
    status: str = "upcoming"
    color: str = "#3d6a99"
    rider_stage1: Optional[str] = None
    rider_stage2: Optional[str] = None
    rider_notes: Optional[str] = None
    
    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Nazwa eventu jest wymagana')
        return v.strip()
    
    @field_validator('expected_attendees', 'ticket_price')
    @classmethod
    def non_negative(cls, v):
        if v < 0:
            raise ValueError('Wartość nie może być ujemna')
        return v


class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    venue: Optional[str] = None
    expected_attendees: Optional[int] = None
    ticket_price: Optional[float] = None
    status: Optional[str] = None
    color: Optional[str] = None
    rider_stage1: Optional[str] = None
    rider_stage2: Optional[str] = None
    rider_notes: Optional[str] = None


class EventResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    event_date: datetime
    end_date: Optional[datetime] = None
    venue: Optional[str] = "Sala Główna"
    expected_attendees: Optional[int] = 0
    ticket_price: float
    status: Optional[str] = "upcoming"
    color: Optional[str] = "#3d6a99"
    rider_stage1: Optional[str] = None
    rider_stage2: Optional[str] = None
    rider_notes: Optional[str] = None
    has_rider_file: Optional[bool] = False
    rider_file_name: Optional[str] = None
    created_by: Optional[int]
    created_at: datetime
    lineup: Optional[List[LineupEntryResponse]] = []
    
    model_config = {"from_attributes": True}


class EventCalendarResponse(BaseModel):
    """Simplified event for calendar view"""
    id: int
    name: str
    event_date: datetime
    end_date: Optional[datetime]
    venue: str
    status: str
    color: str
    expected_attendees: int
    
    model_config = {"from_attributes": True}


# ==================== COSTS ====================

class CostCreate(BaseModel):
    event_id: int
    category: CostCategory
    amount: float
    description: Optional[str] = None
    cost_date: Optional[datetime] = None
    receipt_id: Optional[int] = None
    
    @field_validator('amount')
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError('Kwota musi być większa od zera')
        return v


class CostUpdate(BaseModel):
    category: Optional[CostCategory] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    cost_date: Optional[datetime] = None


class CostResponse(BaseModel):
    id: int
    event_id: int
    category: str
    amount: float
    description: Optional[str]
    cost_date: Optional[datetime]
    receipt_id: Optional[int]
    created_by: Optional[int]
    created_at: datetime
    
    model_config = {"from_attributes": True}


# ==================== REVENUE ====================

class RevenueCreate(BaseModel):
    event_id: int
    source: RevenueSource
    amount: float
    description: Optional[str] = None
    
    @field_validator('amount')
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError('Kwota musi być większa od zera')
        return v


class RevenueUpdate(BaseModel):
    source: Optional[RevenueSource] = None
    amount: Optional[float] = None
    description: Optional[str] = None


class RevenueResponse(BaseModel):
    id: int
    event_id: int
    source: str
    amount: float
    description: Optional[str]
    recorded_by: Optional[int]
    created_at: datetime
    
    model_config = {"from_attributes": True}


# ==================== RECEIPTS ====================

class ReceiptResponse(BaseModel):
    id: int
    store_name: Optional[str]
    receipt_date: Optional[datetime]
    total_amount: Optional[float]
    ocr_text: Optional[str]
    parsed_items: Optional[List] = None
    status: str
    uploaded_by: int
    uploader_name: Optional[str] = None
    processed_by: Optional[int]
    processor_name: Optional[str] = None
    created_at: datetime
    processed_at: Optional[datetime]
    has_image: bool = False
    
    model_config = {"from_attributes": True}


class ReceiptToCost(BaseModel):
    receipt_id: int
    event_id: int
    category: CostCategory
    amount: Optional[float] = None
    description: Optional[str] = None


# ==================== CHAT ====================

class ChatMessageCreate(BaseModel):
    content: str
    
    @field_validator('content')
    @classmethod
    def content_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Wiadomość nie może być pusta')
        return v.strip()


class ChatMessageResponse(BaseModel):
    id: int
    sender_id: int
    sender_name: Optional[str] = None
    content: str
    message_type: str
    is_read: bool
    created_at: datetime
    
    model_config = {"from_attributes": True}


# ==================== PRIVATE MESSAGES ====================

class PrivateMessageCreate(BaseModel):
    content: str
    
    @field_validator('content')
    @classmethod
    def content_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Wiadomość nie może być pusta')
        return v.strip()


class PrivateMessageResponse(BaseModel):
    id: int
    sender_id: int
    recipient_id: int
    sender_name: Optional[str] = None
    recipient_name: Optional[str] = None
    content: str
    is_read: bool
    created_at: datetime
    
    model_config = {"from_attributes": True}


class ConversationResponse(BaseModel):
    user_id: int
    user_name: str
    last_message: str
    last_message_time: datetime
    unread_count: int
    is_online: bool = False


# ==================== REPORTS ====================

class DashboardStats(BaseModel):
    total_events: int
    upcoming_events: int
    total_revenue: float
    total_costs: float
    profit: float
    pending_receipts: int


class EventReport(BaseModel):
    event_id: int
    event_name: str
    event_date: datetime
    total_revenue: float
    total_costs: float
    profit: float
    cost_breakdown: dict
    revenue_breakdown: dict


# ==================== STAFF ASSIGNMENTS ====================

class StaffAssignmentCreate(BaseModel):
    user_id: int
    event_id: int
    position: str
    notes: Optional[str] = None


class StaffAssignmentResponse(BaseModel):
    id: int
    user_id: int
    event_id: int
    position: str
    notes: Optional[str]
    user_name: Optional[str] = None
    event_name: Optional[str] = None
    
    model_config = {"from_attributes": True}


# Update forward references
TokenResponse.model_rebuild()
