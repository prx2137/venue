"""
Pydantic Schemas for Music Venue Management System
With Receipt OCR and Live Chat support
"""

from pydantic import BaseModel, EmailStr, field_validator, model_validator
from typing import Optional, List, Dict, Any
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
    OTHER = "other"


class RevenueSource(str, Enum):
    BOX_OFFICE = "box_office"
    BAR_SALES = "bar_sales"
    MERCHANDISE = "merchandise"
    SPONSORSHIP = "sponsorship"
    OTHER = "other"


class ReceiptStatus(str, Enum):
    PENDING = "pending"
    PROCESSED = "processed"
    REJECTED = "rejected"


class MessageType(str, Enum):
    TEXT = "text"
    SYSTEM = "system"
    ANNOUNCEMENT = "announcement"


# ==================== AUTH ====================

class UserLogin(BaseModel):
    email: EmailStr
    password: str


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
    created_at: datetime
    
    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
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
    role: UserRole = UserRole.WORKER
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
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ==================== EVENTS ====================

class EventCreate(BaseModel):
    name: str
    description: Optional[str] = None
    event_date: datetime
    venue_capacity: int = 0
    ticket_price: float = 0.0
    
    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError('Nazwa wydarzenia jest wymagana')
        return v.strip()
    
    @field_validator('venue_capacity', 'ticket_price')
    @classmethod
    def non_negative(cls, v):
        if v < 0:
            raise ValueError('Wartość nie może być ujemna')
        return v


class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[datetime] = None
    venue_capacity: Optional[int] = None
    ticket_price: Optional[float] = None


class EventResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    event_date: datetime
    venue_capacity: int
    ticket_price: float
    created_by: Optional[int]
    created_at: datetime
    
    model_config = {"from_attributes": True}


# ==================== COSTS ====================

class CostCreate(BaseModel):
    event_id: int
    category: CostCategory
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
    category: Optional[CostCategory] = None
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
    description: Optional[str]
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
    
    @field_validator('amount')
    @classmethod
    def amount_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError('Kwota musi być większa od zera')
        return v


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
    store_name: Optional[str]
    receipt_date: Optional[datetime]
    total_amount: Optional[float]
    ocr_result: ReceiptOCRResult
    status: str
    has_image: bool = False
    created_at: datetime
    
    model_config = {"from_attributes": True}


class ReceiptResponse(BaseModel):
    id: int
    store_name: Optional[str]
    receipt_date: Optional[datetime]
    total_amount: Optional[float]
    status: str
    uploaded_by: int
    uploaded_by_name: Optional[str] = None
    processed_by: Optional[int]
    has_image: bool = False
    created_at: datetime
    processed_at: Optional[datetime]
    
    model_config = {"from_attributes": True}


class CreateCostsFromReceipt(BaseModel):
    receipt_id: int
    event_id: int
    category: CostCategory = CostCategory.BAR_SUPPLIES


# ==================== CHAT ====================

class ChatMessageCreate(BaseModel):
    content: str
    message_type: MessageType = MessageType.TEXT
    
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
    is_read: bool
    created_at: datetime
    
    model_config = {"from_attributes": True}


class ChatUserStatus(BaseModel):
    user_id: int
    full_name: str
    role: str
    is_online: bool
    last_seen: Optional[datetime] = None


class ChatHistoryResponse(BaseModel):
    messages: List[ChatMessageResponse]
    users_online: List[ChatUserStatus]
    total_unread: int


# ==================== REPORTS ====================

class EventReport(BaseModel):
    event_id: int
    event_name: str
    event_date: datetime
    total_costs: float
    total_revenue: float
    net_profit: float
    profit_margin: float
    costs_breakdown: Dict[str, float]
    revenue_breakdown: Dict[str, float]


class PeriodReport(BaseModel):
    period_from: datetime
    period_to: datetime
    events_count: int
    total_costs: float
    total_revenue: float
    net_profit: float
    profit_margin: float


# ==================== CATEGORIES ====================

class CategoriesResponse(BaseModel):
    cost_categories: Dict[str, str]
    revenue_sources: Dict[str, str]


# ==================== GENERAL ====================

class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None
