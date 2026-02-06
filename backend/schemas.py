"""
Pydantic Schemas for Music Venue Management System
Extended with Receipts and OCR support
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, field_validator, model_validator
from enum import Enum


# ==================== ENUMS ====================

class CostCategoryEnum(str, Enum):
    bar_alcohol = "bar_alcohol"
    bar_beverages = "bar_beverages"
    bar_food = "bar_food"
    bar_supplies = "bar_supplies"
    staff_wages = "staff_wages"
    equipment_rental = "equipment_rental"
    marketing = "marketing"
    utilities = "utilities"
    maintenance = "maintenance"
    cleaning = "cleaning"
    security = "security"
    artist_fee = "artist_fee"
    sound_engineer = "sound_engineer"
    lighting = "lighting"
    licenses = "licenses"
    insurance = "insurance"
    other = "other"


class RevenueSourceEnum(str, Enum):
    box_office = "box_office"
    bar_sales = "bar_sales"
    merchandise = "merchandise"
    sponsorship = "sponsorship"
    rental = "rental"
    other = "other"


class ReceiptStatusEnum(str, Enum):
    pending = "pending"
    processing = "processing"
    processed = "processed"
    verified = "verified"
    rejected = "rejected"


# ==================== USER SCHEMAS ====================

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: Optional[str] = "worker"
    
    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Hasło musi mieć minimum 8 znaków')
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime
    
    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ==================== EVENT SCHEMAS ====================

class EventCreate(BaseModel):
    name: str
    date: datetime
    description: Optional[str] = None
    capacity: Optional[int] = None
    ticket_price: Optional[float] = None
    status: Optional[str] = "planned"


class EventUpdate(BaseModel):
    name: Optional[str] = None
    date: Optional[datetime] = None
    description: Optional[str] = None
    capacity: Optional[int] = None
    ticket_price: Optional[float] = None
    status: Optional[str] = None


class EventResponse(BaseModel):
    id: int
    name: str
    date: datetime
    description: Optional[str]
    capacity: Optional[int]
    ticket_price: Optional[float]
    status: str
    created_by: Optional[int]
    created_at: datetime
    
    model_config = {"from_attributes": True}


class EventListResponse(BaseModel):
    events: List[EventResponse]
    total: int


# ==================== COST SCHEMAS ====================

class CostCreate(BaseModel):
    event_id: Optional[int] = None  # Optional - can be general cost
    category: CostCategoryEnum
    amount: float
    description: Optional[str] = None
    vendor: Optional[str] = None
    invoice_number: Optional[str] = None
    receipt_id: Optional[int] = None
    cost_date: Optional[datetime] = None
    
    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('Kwota musi być większa od 0')
        return v


class CostUpdate(BaseModel):
    category: Optional[CostCategoryEnum] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    vendor: Optional[str] = None
    invoice_number: Optional[str] = None
    receipt_id: Optional[int] = None
    cost_date: Optional[datetime] = None


class CostResponse(BaseModel):
    id: int
    event_id: Optional[int]
    category: str
    amount: float
    description: Optional[str]
    vendor: Optional[str]
    invoice_number: Optional[str]
    receipt_id: Optional[int]
    created_by: Optional[int]
    created_at: datetime
    cost_date: Optional[datetime]
    
    model_config = {"from_attributes": True}


# ==================== RECEIPT SCHEMAS ====================

class ReceiptUploadResponse(BaseModel):
    id: int
    filename: str
    status: str
    message: str


class OCRItem(BaseModel):
    name: str
    quantity: Optional[float] = 1.0
    unit_price: Optional[float] = None
    total_price: Optional[float] = None
    category_suggestion: Optional[str] = None


class ReceiptOCRResult(BaseModel):
    store_name: Optional[str] = None
    receipt_date: Optional[datetime] = None
    receipt_number: Optional[str] = None
    items: List[OCRItem] = []
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    total: Optional[float] = None
    currency: str = "PLN"
    confidence: float = 0.0
    raw_text: Optional[str] = None


class ReceiptUpdate(BaseModel):
    store_name: Optional[str] = None
    receipt_date: Optional[datetime] = None
    receipt_number: Optional[str] = None
    total_amount: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[ReceiptStatusEnum] = None


class ReceiptResponse(BaseModel):
    id: int
    filename: str
    content_type: Optional[str]
    file_size: Optional[int]
    store_name: Optional[str]
    receipt_date: Optional[datetime]
    receipt_number: Optional[str]
    total_amount: Optional[float]
    currency: str
    status: str
    ocr_confidence: Optional[float]
    uploaded_by: Optional[int]
    uploaded_at: datetime
    processed_at: Optional[datetime]
    verified_at: Optional[datetime]
    notes: Optional[str]
    
    model_config = {"from_attributes": True}


class ReceiptDetailResponse(ReceiptResponse):
    ocr_raw_text: Optional[str]
    ocr_items: Optional[str]  # JSON string


class ReceiptListResponse(BaseModel):
    receipts: List[ReceiptResponse]
    total: int


# ==================== REVENUE SCHEMAS ====================

class RevenueCreate(BaseModel):
    event_id: Optional[int] = None
    source: RevenueSourceEnum
    amount: float
    description: Optional[str] = None
    revenue_date: Optional[datetime] = None
    
    @field_validator('amount')
    @classmethod
    def amount_must_be_positive(cls, v):
        if v <= 0:
            raise ValueError('Kwota musi być większa od 0')
        return v


class RevenueUpdate(BaseModel):
    source: Optional[RevenueSourceEnum] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    revenue_date: Optional[datetime] = None


class RevenueResponse(BaseModel):
    id: int
    event_id: Optional[int]
    source: str
    amount: float
    description: Optional[str]
    recorded_by: Optional[int]
    created_at: datetime
    revenue_date: Optional[datetime]
    
    model_config = {"from_attributes": True}


# ==================== REPORT SCHEMAS ====================

class ReportResponse(BaseModel):
    event_id: int
    event_name: str
    event_date: datetime
    total_costs: float
    total_revenue: float
    net_profit: float
    profit_margin: float
    costs_breakdown: Dict[str, float]
    revenue_breakdown: Dict[str, float]


class PeriodReportResponse(BaseModel):
    period_from: datetime
    period_to: datetime
    events_count: int
    total_costs: float
    total_revenue: float
    net_profit: float
    profit_margin: float


class CategoryBreakdown(BaseModel):
    category: str
    label: str
    amount: float
    percentage: float
    count: int


class DetailedReportResponse(BaseModel):
    period_from: datetime
    period_to: datetime
    events_count: int
    total_costs: float
    total_revenue: float
    net_profit: float
    profit_margin: float
    costs_by_category: List[CategoryBreakdown]
    revenue_by_source: List[CategoryBreakdown]
    top_expenses: List[CostResponse]
    receipts_summary: Dict[str, Any]


# ==================== UTILITY SCHEMAS ====================

class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None


class CategoriesResponse(BaseModel):
    cost_categories: List[Dict[str, str]]
    revenue_sources: List[Dict[str, str]]
    user_roles: List[Dict[str, str]]
    receipt_statuses: List[Dict[str, str]]
