"""
Pydantic Schemas for Music Venue Management System
With Receipt OCR, Live Chat, and Calendar support
FIXED VERSION - Added missing schemas
"""

from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List, Dict
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
    BAR_STOCK = "bar_stock"
    ARTIST_FEE = "artist_fee"
    SOUND_ENGINEER = "sound_engineer"
    LIGHTING = "lighting"
    STAFF_WAGES = "staff_wages"
    STAFF = "staff"
    SECURITY = "security"
    CLEANING = "cleaning"
    UTILITIES = "utilities"
    RENT = "rent"
    EQUIPMENT = "equipment"
    MARKETING = "marketing"
    OTHER = "other"


class RevenueSource(str, Enum):
    BOX_OFFICE = "box_office"
    TICKETS = "tickets"
    BAR_SALES = "bar_sales"
    BAR = "bar"
    MERCHANDISE = "merchandise"
    SPONSORSHIP = "sponsorship"
    OTHER = "other"


class ReceiptStatus(str, Enum):
    PENDING = "pending"
    SCANNED = "scanned"
    PROCESSED = "processed"
    REJECTED = "rejected"


class MessageType(str, Enum):
    TEXT = "text"
    SYSTEM = "system"
    ANNOUNCEMENT = "announcement"


# ==================== AUTH ====================

class UserLogin(BaseModel):
    """Login request schema"""
    email: EmailStr
    password: str


# Alias for backwards compatibility
LoginRequest = UserLogin


class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: UserRole = UserRole.WORKER
    
    @field_validator('password')
    @classmethod
    def password_strength(cls, v):
        if len(v) < 6:
            raise ValueError('Hasło musi mieć minimum 6 znaków')
        return v
    
    @field_validator('full_name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Imię i nazwisko jest wymagane')
        return v.strip()


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None
    
    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    
    @field_validator('password')
    @classmethod
    def password_strength(cls, v):
        if v is not None and len(v) < 6:
            raise ValueError('Hasło musi mieć minimum 6 znaków')
        return v


class UserCreate(BaseModel):
    """Schema for managers/owners to create new users"""
    email: EmailStr
    password: str
    full_name: str
    role: str = "worker"
    is_active: bool = True
    
    @field_validator('password')
    @classmethod
    def password_strength(cls, v):
        if len(v) < 6:
            raise ValueError('Hasło musi mieć minimum 6 znaków')
        return v
    
    @field_validator('full_name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Imię i nazwisko jest wymagane')
        return v.strip()


class Token(BaseModel):
    """Token response after successful login"""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# Alias for backwards compatibility - THIS WAS MISSING!
TokenResponse = Token


# ==================== EVENTS ====================

class EventCreate(BaseModel):
    name: str
    description: Optional[str] = None
    date: datetime  # Changed from event_date to match model
    venue_capacity: Optional[int] = 0
    ticket_price: Optional[float] = 0.0
    expected_attendees: Optional[int] = 0
    genre: Optional[str] = None
    status: Optional[str] = "upcoming"
    notes: Optional[str] = None
    
    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Nazwa wydarzenia jest wymagana')
        return v.strip()


class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    date: Optional[datetime] = None
    venue_capacity: Optional[int] = None
    ticket_price: Optional[float] = None
    expected_attendees: Optional[int] = None
    actual_attendees: Optional[int] = None
    genre: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class EventResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    date: datetime
    ticket_price: float = 0
    expected_attendees: int = 0
    actual_attendees: Optional[int] = None
    genre: Optional[str] = None
    status: str = "upcoming"
    notes: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    
    model_config = {"from_attributes": True}


# ==================== COSTS ====================

class CostCreate(BaseModel):
    event_id: int
    category: str
    amount: float
    description: Optional[str] = None
    receipt_id: Optional[int] = None
    
    @field_validator('amount')
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError('Kwota musi być większa od zera')
        return v


class CostUpdate(BaseModel):
    category: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    
    @field_validator('amount')
    @classmethod
    def amount_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError('Kwota musi być większa od zera')
        return v


class CostResponse(BaseModel):
    id: int
    event_id: int
    category: str
    amount: float
    description: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    
    model_config = {"from_attributes": True}


# ==================== REVENUE ====================

class RevenueCreate(BaseModel):
    event_id: int
    category: str  # Changed from 'source' to match model
    amount: float
    description: Optional[str] = None
    
    @field_validator('amount')
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError('Kwota musi być większa od zera')
        return v


class RevenueUpdate(BaseModel):
    category: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    
    @field_validator('amount')
    @classmethod
    def amount_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError('Kwota musi być większa od zera')
        return v


class RevenueResponse(BaseModel):
    id: int
    event_id: int
    category: str
    amount: float
    description: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    
    model_config = {"from_attributes": True}


# ==================== STAFF ASSIGNMENTS - MISSING! ====================

class StaffAssignmentCreate(BaseModel):
    """Schema for creating staff assignments"""
    event_id: int
    position: str
    name: str
    hours: Optional[float] = None
    hourly_rate: Optional[float] = None
    notes: Optional[str] = None
    
    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Imię pracownika jest wymagane')
        return v.strip()
    
    @field_validator('position')
    @classmethod
    def position_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Stanowisko jest wymagane')
        return v.strip()


class StaffAssignmentUpdate(BaseModel):
    """Schema for updating staff assignments"""
    position: Optional[str] = None
    name: Optional[str] = None
    hours: Optional[float] = None
    hourly_rate: Optional[float] = None
    notes: Optional[str] = None


class StaffAssignmentResponse(BaseModel):
    """Schema for staff assignment response"""
    id: int
    event_id: int
    position: str
    name: str
    hours: Optional[float] = None
    hourly_rate: Optional[float] = None
    notes: Optional[str] = None
    
    model_config = {"from_attributes": True}


# ==================== RECEIPTS ====================

class ReceiptUpload(BaseModel):
    """Upload receipt via text (legacy)"""
    ocr_text: str
    
    @field_validator('ocr_text')
    @classmethod
    def text_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Tekst paragonu jest wymagany')
        return v.strip()


class OCRItem(BaseModel):
    name: str
    quantity: float = 1.0
    price: float
    category: Optional[str] = None


class ReceiptOCRResult(BaseModel):
    store_name: Optional[str] = None
    receipt_date: Optional[str] = None
    items: List[OCRItem] = []
    total: Optional[float] = None
    raw_text: Optional[str] = None


class ReceiptUploadResponse(BaseModel):
    id: int
    store_name: Optional[str] = None
    receipt_date: Optional[str] = None
    total_amount: Optional[float] = None
    items: List[OCRItem] = []
    status: str
    message: str = ""
    has_image: bool = False


class ReceiptResponse(BaseModel):
    id: int
    store_name: Optional[str] = None
    receipt_date: Optional[str] = None
    total_amount: Optional[float] = None
    status: str
    uploaded_by: int
    uploader_name: Optional[str] = None
    has_image: bool = False
    created_at: datetime
    
    model_config = {"from_attributes": True}


class CreateCostsFromReceipt(BaseModel):
    receipt_id: int
    event_id: int
    category: str = "bar_supplies"


# THIS WAS MISSING!
class ReceiptToCost(BaseModel):
    """Schema for creating cost from receipt"""
    event_id: int
    amount: Optional[float] = None
    description: Optional[str] = None
    category: Optional[str] = "bar_stock"


# ==================== CHAT ====================

class ChatMessageCreate(BaseModel):
    content: str
    message_type: Optional[str] = "text"
    
    @field_validator('content')
    @classmethod
    def content_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Wiadomość nie może być pusta')
        if len(v) > 2000:
            raise ValueError('Wiadomość może mieć maksymalnie 2000 znaków')
        return v.strip()


class ChatMessageResponse(BaseModel):
    id: int
    sender_id: int
    sender_name: str
    sender_role: str
    content: str
    message_type: str
    created_at: datetime
    
    model_config = {"from_attributes": True}


class ChatUserStatus(BaseModel):
    user_id: int
    user_name: str
    role: str
    is_online: bool


class ChatHistoryResponse(BaseModel):
    messages: List[ChatMessageResponse]


# ==================== REPORTS ====================

class EventReport(BaseModel):
    event_id: int
    event_name: str
    event_date: datetime
    total_costs: float
    total_revenue: float
    net_profit: float
    costs_by_category: Dict[str, float] = {}
    revenue_by_source: Dict[str, float] = {}


class PeriodReport(BaseModel):
    period_from: datetime
    period_to: datetime
    events_count: int
    total_costs: float
    total_revenue: float
    net_profit: float


# ==================== CATEGORIES ====================

class CategoriesResponse(BaseModel):
    cost_categories: List[str]
    revenue_sources: List[str]


# ==================== GENERAL ====================

class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None
