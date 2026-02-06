"""
Music Venue Management System - FastAPI Backend
With Receipt OCR and Extended Cost Management
"""

import os
import json
import base64
import re
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from pathlib import Path

from database import engine, get_db, Base
from models import User, Event, Cost, Revenue, Receipt, FinancialReport, UserRole, CostCategory, RevenueSource, ReceiptStatus
from schemas import (
    UserCreate, UserResponse, UserLogin, Token, UserUpdate,
    EventCreate, EventUpdate, EventResponse, EventListResponse,
    CostCreate, CostUpdate, CostResponse,
    RevenueCreate, RevenueUpdate, RevenueResponse,
    ReceiptUploadResponse, ReceiptResponse, ReceiptDetailResponse, ReceiptUpdate, ReceiptListResponse, ReceiptOCRResult, OCRItem,
    ReportResponse, PeriodReportResponse, DetailedReportResponse, CategoryBreakdown,
    CategoriesResponse, MessageResponse
)
from security import (
    verify_password, get_password_hash, create_access_token,
    verify_token, SECRET_KEY
)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Music Venue Management System",
    description="API do zarządzania finansami klubu muzycznego z OCR paragonów",
    version="2.0.0"
)

# CORS - Allow all for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)

# ==================== AUTH HELPERS ====================

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Brak tokena autoryzacji")
    
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Nieprawidłowy token")
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Nieprawidłowy token")
    
    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Użytkownik nieaktywny")
    
    return user


def require_role(allowed_roles: list):
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Brak uprawnień")
        return current_user
    return role_checker


# ==================== STARTUP ====================

@app.on_event("startup")
async def startup_event():
    db = next(get_db())
    
    # Create default users if not exist
    default_users = [
        {"email": "admin@venue.com", "password": "Admin123!", "full_name": "Administrator", "role": "owner"},
        {"email": "manager@venue.com", "password": "Manager123!", "full_name": "Manager Klubu", "role": "manager"},
        {"email": "worker@venue.com", "password": "Worker123!", "full_name": "Pracownik", "role": "worker"},
    ]
    
    created = False
    for user_data in default_users:
        existing = db.query(User).filter(User.email == user_data["email"]).first()
        if not existing:
            user = User(
                email=user_data["email"],
                password_hash=get_password_hash(user_data["password"]),
                full_name=user_data["full_name"],
                role=user_data["role"]
            )
            db.add(user)
            created = True
    
    if created:
        db.commit()
        print("✅ Default users created")


# ==================== HEALTH CHECK ====================

@app.get("/health")
def health_check():
    return {"status": "healthy", "version": "2.0.0"}


@app.get("/")
def root():
    return {
        "message": "Music Venue Management System API",
        "version": "2.0.0",
        "docs": "/docs",
        "frontend": "/app"
    }


# ==================== AUTH ENDPOINTS ====================

@app.post("/api/auth/login", response_model=Token)
def login(user_data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == user_data.email).first()
    
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Nieprawidłowy email lub hasło")
    
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Konto nieaktywne")
    
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }


@app.post("/api/auth/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email już zarejestrowany")
    
    user = User(
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        role="worker"  # Default role for self-registration
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


# ==================== USER MANAGEMENT ====================

@app.get("/api/users", response_model=List[UserResponse])
def list_users(
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    return db.query(User).all()


@app.put("/api/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_data: UserUpdate,
    current_user: User = Depends(require_role(["owner"])),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    update_data = user_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)
    
    db.commit()
    db.refresh(user)
    return user


@app.delete("/api/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: User = Depends(require_role(["owner"])),
    db: Session = Depends(get_db)
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie możesz usunąć siebie")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    db.delete(user)
    db.commit()
    return {"message": "Użytkownik usunięty"}


# ==================== EVENT ENDPOINTS ====================

@app.post("/api/events", response_model=EventResponse)
def create_event(
    event_data: EventCreate,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    event = Event(**event_data.model_dump(), created_by=current_user.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@app.get("/api/events", response_model=EventListResponse)
def list_events(
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Event)
    if status:
        query = query.filter(Event.status == status)
    
    total = query.count()
    events = query.order_by(desc(Event.date)).offset(skip).limit(limit).all()
    return {"events": events, "total": total}


@app.get("/api/events/{event_id}", response_model=EventResponse)
def get_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    return event


@app.put("/api/events/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    event_data: EventUpdate,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    update_data = event_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(event, field, value)
    
    db.commit()
    db.refresh(event)
    return event


@app.delete("/api/events/{event_id}")
def delete_event(
    event_id: int,
    current_user: User = Depends(require_role(["owner"])),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    db.delete(event)
    db.commit()
    return {"message": "Wydarzenie usunięte"}


# ==================== RECEIPT / OCR ENDPOINTS ====================

def simple_ocr_parse(text: str) -> ReceiptOCRResult:
    """
    Simple receipt parser - extracts basic info from OCR text.
    In production, use dedicated OCR API (Google Vision, AWS Textract, etc.)
    """
    result = ReceiptOCRResult()
    lines = text.strip().split('\n')
    
    # Common Polish store patterns
    store_patterns = {
        'biedronka': 'Biedronka',
        'lidl': 'Lidl',
        'żabka': 'Żabka',
        'zabka': 'Żabka',
        'carrefour': 'Carrefour',
        'auchan': 'Auchan',
        'kaufland': 'Kaufland',
        'tesco': 'Tesco',
        'makro': 'Makro',
        'selgros': 'Selgros',
        'hurtownia': 'Hurtownia',
        'lewiatan': 'Lewiatan',
        'dino': 'Dino',
        'netto': 'Netto',
        'stokrotka': 'Stokrotka',
        'polo market': 'Polo Market',
    }
    
    # Try to find store name
    text_lower = text.lower()
    for pattern, name in store_patterns.items():
        if pattern in text_lower:
            result.store_name = name
            break
    
    # Try to find date (formats: DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY)
    date_patterns = [
        r'(\d{2})[.\-/](\d{2})[.\-/](\d{4})',
        r'(\d{4})[.\-/](\d{2})[.\-/](\d{2})',
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text)
        if match:
            try:
                groups = match.groups()
                if len(groups[0]) == 4:  # YYYY-MM-DD format
                    result.receipt_date = datetime(int(groups[0]), int(groups[1]), int(groups[2]))
                else:  # DD-MM-YYYY format
                    result.receipt_date = datetime(int(groups[2]), int(groups[1]), int(groups[0]))
                break
            except:
                pass
    
    # Try to find total (SUMA, RAZEM, TOTAL, DO ZAPŁATY)
    total_patterns = [
        r'(?:suma|razem|total|do zap[łl]aty|zap[łl]acono)[:\s]*(\d+[,\.]\d{2})',
        r'(\d+[,\.]\d{2})\s*(?:pln|zł|zl)',
    ]
    for pattern in total_patterns:
        match = re.search(pattern, text_lower)
        if match:
            try:
                total_str = match.group(1).replace(',', '.')
                result.total = float(total_str)
                break
            except:
                pass
    
    # Try to find receipt number (NR, PARAGON, FAKTURA)
    receipt_patterns = [
        r'(?:nr|paragon|faktura|dok)[:\s#]*([A-Z0-9\-/]+)',
    ]
    for pattern in receipt_patterns:
        match = re.search(pattern, text_lower)
        if match:
            result.receipt_number = match.group(1).upper()
            break
    
    # Parse items (basic pattern: name followed by price)
    items = []
    item_pattern = r'^(.+?)\s+(\d+[,\.]\d{2})\s*[A-Z]?$'
    for line in lines:
        match = re.match(item_pattern, line.strip())
        if match:
            name = match.group(1).strip()
            price_str = match.group(2).replace(',', '.')
            if len(name) > 2 and len(name) < 50:
                items.append(OCRItem(
                    name=name,
                    total_price=float(price_str),
                    category_suggestion=categorize_item(name)
                ))
    
    result.items = items
    result.raw_text = text
    result.confidence = 60.0 if result.store_name or result.total else 30.0
    
    return result


def categorize_item(name: str) -> str:
    """Suggest cost category based on item name"""
    name_lower = name.lower()
    
    alcohol_keywords = ['wódka', 'vodka', 'piwo', 'beer', 'wino', 'wine', 'rum', 'whisky', 'gin', 'likier', 'alkohol']
    beverage_keywords = ['cola', 'fanta', 'sprite', 'sok', 'juice', 'woda', 'water', 'napój', 'red bull', 'monster']
    food_keywords = ['chips', 'orzeszki', 'paluszki', 'snack', 'przekąsk', 'kanapk', 'sandwich']
    supplies_keywords = ['kubek', 'słomk', 'serwetk', 'talerz', 'sztućc', 'reklamówk', 'torb']
    cleaning_keywords = ['środek', 'czyszcz', 'mydło', 'papier toalet', 'ręcznik']
    
    for kw in alcohol_keywords:
        if kw in name_lower:
            return 'bar_alcohol'
    for kw in beverage_keywords:
        if kw in name_lower:
            return 'bar_beverages'
    for kw in food_keywords:
        if kw in name_lower:
            return 'bar_food'
    for kw in supplies_keywords:
        if kw in name_lower:
            return 'bar_supplies'
    for kw in cleaning_keywords:
        if kw in name_lower:
            return 'cleaning'
    
    return 'other'


@app.post("/api/receipts/upload", response_model=ReceiptUploadResponse)
async def upload_receipt(
    file: UploadFile = File(...),
    event_id: Optional[int] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload a receipt image for processing"""
    
    # Validate file type
    allowed_types = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf']
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Nieobsługiwany format pliku. Dozwolone: {', '.join(allowed_types)}")
    
    # Read file
    file_data = await file.read()
    file_size = len(file_data)
    
    # Max 10MB
    if file_size > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Plik zbyt duży. Maksymalnie 10MB.")
    
    # Create receipt record
    receipt = Receipt(
        filename=file.filename,
        content_type=file.content_type,
        file_data=file_data,
        file_size=file_size,
        status=ReceiptStatus.pending.value,
        uploaded_by=current_user.id
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    
    return ReceiptUploadResponse(
        id=receipt.id,
        filename=receipt.filename,
        status=receipt.status,
        message="Paragon przesłany. Użyj /api/receipts/{id}/process aby przetworzyć OCR."
    )


@app.post("/api/receipts/{receipt_id}/process", response_model=ReceiptOCRResult)
async def process_receipt_ocr(
    receipt_id: int,
    ocr_text: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Process receipt with OCR.
    If ocr_text is provided, use it directly (for client-side OCR).
    Otherwise, returns instructions for manual entry or external OCR.
    """
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    receipt.status = ReceiptStatus.processing.value
    db.commit()
    
    if ocr_text:
        # Process provided OCR text
        result = simple_ocr_parse(ocr_text)
        
        # Update receipt with OCR results
        receipt.store_name = result.store_name
        receipt.receipt_date = result.receipt_date
        receipt.receipt_number = result.receipt_number
        receipt.total_amount = result.total
        receipt.ocr_raw_text = result.raw_text
        receipt.ocr_items = json.dumps([item.model_dump() for item in result.items])
        receipt.ocr_confidence = result.confidence
        receipt.status = ReceiptStatus.processed.value
        receipt.processed_at = datetime.utcnow()
        
        db.commit()
        return result
    else:
        # Return instruction for manual/external OCR
        receipt.status = ReceiptStatus.pending.value
        db.commit()
        
        return ReceiptOCRResult(
            raw_text="Proszę przesłać tekst OCR lub użyć zewnętrznego serwisu OCR (Google Vision, Tesseract) i przesłać wynik.",
            confidence=0.0
        )


@app.get("/api/receipts", response_model=ReceiptListResponse)
def list_receipts(
    skip: int = 0,
    limit: int = 50,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Receipt)
    if status:
        query = query.filter(Receipt.status == status)
    
    total = query.count()
    receipts = query.order_by(desc(Receipt.uploaded_at)).offset(skip).limit(limit).all()
    return {"receipts": receipts, "total": total}


@app.get("/api/receipts/{receipt_id}", response_model=ReceiptDetailResponse)
def get_receipt(
    receipt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    return receipt


@app.get("/api/receipts/{receipt_id}/image")
def get_receipt_image(
    receipt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get receipt image data"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    if not receipt.file_data:
        raise HTTPException(status_code=404, detail="Brak obrazu paragonu")
    
    return Response(content=receipt.file_data, media_type=receipt.content_type)


@app.put("/api/receipts/{receipt_id}", response_model=ReceiptResponse)
def update_receipt(
    receipt_id: int,
    receipt_data: ReceiptUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    update_data = receipt_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(receipt, field, value.value if hasattr(value, 'value') else value)
    
    db.commit()
    db.refresh(receipt)
    return receipt


@app.post("/api/receipts/{receipt_id}/verify")
def verify_receipt(
    receipt_id: int,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    """Mark receipt as manually verified"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    receipt.status = ReceiptStatus.verified.value
    receipt.verified_by = current_user.id
    receipt.verified_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Paragon zweryfikowany", "status": receipt.status}


@app.delete("/api/receipts/{receipt_id}")
def delete_receipt(
    receipt_id: int,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    db.delete(receipt)
    db.commit()
    return {"message": "Paragon usunięty"}


@app.post("/api/receipts/{receipt_id}/create-costs")
def create_costs_from_receipt(
    receipt_id: int,
    event_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create cost entries from receipt items"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    if not receipt.ocr_items:
        raise HTTPException(status_code=400, detail="Paragon nie ma rozpoznanych pozycji")
    
    try:
        items = json.loads(receipt.ocr_items)
    except:
        raise HTTPException(status_code=400, detail="Błąd parsowania pozycji paragonu")
    
    created_costs = []
    for item in items:
        cost = Cost(
            event_id=event_id,
            category=item.get('category_suggestion', 'other'),
            amount=item.get('total_price', 0),
            description=item.get('name', 'Pozycja z paragonu'),
            vendor=receipt.store_name,
            receipt_id=receipt.id,
            created_by=current_user.id,
            cost_date=receipt.receipt_date or datetime.utcnow()
        )
        db.add(cost)
        created_costs.append(cost)
    
    db.commit()
    
    return {
        "message": f"Utworzono {len(created_costs)} kosztów z paragonu",
        "costs_count": len(created_costs)
    }


# ==================== COST ENDPOINTS ====================

@app.post("/api/costs", response_model=CostResponse)
def create_cost(
    cost_data: CostCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cost = Cost(**cost_data.model_dump(), created_by=current_user.id)
    db.add(cost)
    db.commit()
    db.refresh(cost)
    return cost


@app.get("/api/costs", response_model=List[CostResponse])
def list_costs(
    skip: int = 0,
    limit: int = 100,
    event_id: Optional[int] = None,
    category: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Cost)
    if event_id is not None:
        query = query.filter(Cost.event_id == event_id)
    if category:
        query = query.filter(Cost.category == category)
    
    return query.order_by(desc(Cost.created_at)).offset(skip).limit(limit).all()


@app.get("/api/costs/event/{event_id}", response_model=List[CostResponse])
def get_event_costs(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return db.query(Cost).filter(Cost.event_id == event_id).all()


@app.put("/api/costs/{cost_id}", response_model=CostResponse)
def update_cost(
    cost_id: int,
    cost_data: CostUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Koszt nie znaleziony")
    
    update_data = cost_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(cost, field, value.value if hasattr(value, 'value') else value)
    
    db.commit()
    db.refresh(cost)
    return cost


@app.delete("/api/costs/{cost_id}")
def delete_cost(
    cost_id: int,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Koszt nie znaleziony")
    
    db.delete(cost)
    db.commit()
    return {"message": "Koszt usunięty"}


# ==================== REVENUE ENDPOINTS ====================

@app.post("/api/revenue", response_model=RevenueResponse)
def create_revenue(
    revenue_data: RevenueCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    revenue = Revenue(**revenue_data.model_dump(), recorded_by=current_user.id)
    db.add(revenue)
    db.commit()
    db.refresh(revenue)
    return revenue


@app.get("/api/revenue/event/{event_id}", response_model=List[RevenueResponse])
def get_event_revenue(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return db.query(Revenue).filter(Revenue.event_id == event_id).all()


@app.put("/api/revenue/{revenue_id}", response_model=RevenueResponse)
def update_revenue(
    revenue_id: int,
    revenue_data: RevenueUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    revenue = db.query(Revenue).filter(Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Przychód nie znaleziony")
    
    update_data = revenue_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(revenue, field, value.value if hasattr(value, 'value') else value)
    
    db.commit()
    db.refresh(revenue)
    return revenue


@app.delete("/api/revenue/{revenue_id}")
def delete_revenue(
    revenue_id: int,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    revenue = db.query(Revenue).filter(Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Przychód nie znaleziony")
    
    db.delete(revenue)
    db.commit()
    return {"message": "Przychód usunięty"}


# ==================== REPORT ENDPOINTS ====================

@app.get("/api/reports/event/{event_id}", response_model=ReportResponse)
def get_event_report(
    event_id: int,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    costs = db.query(Cost).filter(Cost.event_id == event_id).all()
    revenues = db.query(Revenue).filter(Revenue.event_id == event_id).all()
    
    total_costs = sum(c.amount for c in costs)
    total_revenue = sum(r.amount for r in revenues)
    net_profit = total_revenue - total_costs
    profit_margin = (net_profit / total_revenue * 100) if total_revenue > 0 else 0
    
    costs_by_cat = db.query(Cost.category, func.sum(Cost.amount)).filter(
        Cost.event_id == event_id
    ).group_by(Cost.category).all()
    
    revenue_by_src = db.query(Revenue.source, func.sum(Revenue.amount)).filter(
        Revenue.event_id == event_id
    ).group_by(Revenue.source).all()
    
    return {
        "event_id": event.id,
        "event_name": event.name,
        "event_date": event.date,
        "total_costs": round(total_costs, 2),
        "total_revenue": round(total_revenue, 2),
        "net_profit": round(net_profit, 2),
        "profit_margin": round(profit_margin, 2),
        "costs_breakdown": {cat: round(amt, 2) for cat, amt in costs_by_cat},
        "revenue_breakdown": {src: round(amt, 2) for src, amt in revenue_by_src}
    }


@app.get("/api/reports/period", response_model=PeriodReportResponse)
def get_period_report(
    start_date: str,
    end_date: str,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    start = datetime.fromisoformat(start_date)
    end = datetime.fromisoformat(end_date)
    
    events = db.query(Event).filter(Event.date >= start, Event.date <= end).all()
    event_ids = [e.id for e in events]
    
    total_costs = db.query(func.sum(Cost.amount)).filter(Cost.event_id.in_(event_ids)).scalar() or 0
    total_revenue = db.query(func.sum(Revenue.amount)).filter(Revenue.event_id.in_(event_ids)).scalar() or 0
    net_profit = total_revenue - total_costs
    profit_margin = (net_profit / total_revenue * 100) if total_revenue > 0 else 0
    
    return {
        "period_from": start,
        "period_to": end,
        "events_count": len(events),
        "total_costs": round(total_costs, 2),
        "total_revenue": round(total_revenue, 2),
        "net_profit": round(net_profit, 2),
        "profit_margin": round(profit_margin, 2)
    }


@app.get("/api/stats/categories", response_model=CategoriesResponse)
def get_categories(current_user: User = Depends(get_current_user)):
    """Get all available categories and enums"""
    return {
        "cost_categories": [
            {"value": c.value, "label": c.value.replace("_", " ").title()} 
            for c in CostCategory
        ],
        "revenue_sources": [
            {"value": s.value, "label": s.value.replace("_", " ").title()} 
            for s in RevenueSource
        ],
        "user_roles": [
            {"value": r.value, "label": r.value.title()} 
            for r in UserRole
        ],
        "receipt_statuses": [
            {"value": s.value, "label": s.value.replace("_", " ").title()} 
            for s in ReceiptStatus
        ]
    }


# ==================== STATIC FILES (Frontend) ====================
# Serve frontend from multiple possible locations

def find_frontend_path():
    """Find frontend directory - works both locally and on Render"""
    possible_paths = [
        Path(__file__).parent.parent / "frontend",  # ../frontend from backend
        Path(__file__).parent / "frontend",          # ./frontend
        Path("/opt/render/project/src/frontend"),    # Render absolute path
        Path("frontend"),                             # Relative to CWD
    ]
    for path in possible_paths:
        if path.exists() and (path / "index.html").exists():
            return path
    return None


frontend_path = find_frontend_path()

if frontend_path:
    print(f"✅ Frontend found at: {frontend_path}")
    
    @app.get("/app")
    @app.get("/app/{full_path:path}")
    async def serve_frontend(full_path: str = ""):
        if full_path and (frontend_path / full_path).exists():
            return FileResponse(frontend_path / full_path)
        return FileResponse(frontend_path / "index.html")
    
    # Mount static files for CSS, JS, images
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")
else:
    print("⚠️ Frontend directory not found - API only mode")
    
    @app.get("/app")
    @app.get("/app/{full_path:path}")
    async def no_frontend(full_path: str = ""):
        return {"error": "Frontend not deployed. Use API directly at /docs"}
