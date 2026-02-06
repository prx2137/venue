"""
Pydantic Schemas for Music Venue Management System
Input validation and response models
"""

from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, List, Dict
from datetime import datetime
from enum import Enum

# Enums
class UserRole(str, Enum):
    OWNER = "owner"
    MANAGER = "manager"
    WORKER = "worker"

class CostCategory(str, Enum):
    SUPPLIES = "supplies"
    EQUIPMENT = "equipment"
    SERVICES = "services"
    PERSONNEL = "personnel"
    TRANSPORT = "transport"
    OTHER = "other"

class RevenueSource(str, Enum):
    BOX_OFFICE = "box_office"
    BAR = "bar"
    MERCHANDISE = "merchandise"
    OTHER = "other"

# ==================== AUTH SCHEMAS ====================

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, description="Password must be at least 8 characters")
    full_name: str = Field(..., min_length=2, max_length=100)
    
    @field_validator('password')
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not any(c.isupper() for c in v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not any(c.islower() for c in v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not any(c.isdigit() for c in v):
            raise ValueError('Password must contain at least one digit')
        return v

# Alias for backwards compatibility
UserRegister = UserCreate

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

# ==================== USER SCHEMAS ====================

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime
    
    model_config = {"from_attributes": True}

class UserListResponse(BaseModel):
    users: List[UserResponse]
    total: int

# ==================== EVENT SCHEMAS ====================

class EventCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    date: datetime
    capacity: Optional[int] = Field(default=0, ge=0)
    entry_fee: Optional[float] = Field(default=0.0, ge=0)
    description: Optional[str] = None

class EventUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    date: Optional[datetime] = None
    capacity: Optional[int] = Field(None, ge=0)
    entry_fee: Optional[float] = Field(None, ge=0)
    description: Optional[str] = None

class EventResponse(BaseModel):
    id: int
    name: str
    date: datetime
    capacity: int
    entry_fee: float
    description: Optional[str]
    created_by: int
    created_at: datetime
    total_costs: float = 0.0
    total_revenue: float = 0.0
    net_profit: float = 0.0
    
    model_config = {"from_attributes": True}

class EventListResponse(BaseModel):
    events: List[EventResponse]
    total: int

# ==================== COST SCHEMAS ====================

class CostCreate(BaseModel):
    event_id: int
    category: CostCategory
    amount: float = Field(..., gt=0)
    description: Optional[str] = None

class CostUpdate(BaseModel):
    category: Optional[CostCategory] = None
    amount: Optional[float] = Field(None, gt=0)
    description: Optional[str] = None

class CostResponse(BaseModel):
    id: int
    event_id: int
    category: str
    amount: float
    description: Optional[str]
    created_by: int
    created_at: datetime
    
    model_config = {"from_attributes": True}

class CostListResponse(BaseModel):
    costs: List[CostResponse]
    total: int
    total_amount: float

# ==================== REVENUE SCHEMAS ====================

class RevenueCreate(BaseModel):
    event_id: int
    source: RevenueSource
    amount: float = Field(..., gt=0)
    description: Optional[str] = None

class RevenueUpdate(BaseModel):
    source: Optional[RevenueSource] = None
    amount: Optional[float] = Field(None, gt=0)
    description: Optional[str] = None

class RevenueResponse(BaseModel):
    id: int
    event_id: int
    source: str
    amount: float
    description: Optional[str]
    recorded_by: int
    created_at: datetime
    
    model_config = {"from_attributes": True}

class RevenueListResponse(BaseModel):
    revenues: List[RevenueResponse]
    total: int
    total_amount: float

# ==================== REPORT SCHEMAS ====================

class EventFinancialReport(BaseModel):
    event_id: int
    event_name: str
    event_date: datetime
    total_costs: float
    total_revenue: float
    net_profit: float
    profit_margin: float
    costs_by_category: Dict[str, float]
    revenue_by_source: Dict[str, float]

class PeriodFinancialReport(BaseModel):
    period_from: datetime
    period_to: datetime
    total_events: int
    total_costs: float
    total_revenue: float
    net_profit: float
    profit_margin: float
    events: List[EventFinancialReport]

# ==================== SYSTEM SCHEMAS ====================

class HealthCheck(BaseModel):
    status: str
    version: str
    database: str

class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None

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
