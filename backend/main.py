"""
Music Venue Management System - FastAPI Backend
With Receipt OCR and Live Chat Support
"""

from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Set
import json
import re
import os
import asyncio

from database import engine, get_db, Base
from models import User, Event, Cost, Revenue, Receipt, ChatMessage
from models import UserRole, CostCategory, RevenueSource, ReceiptStatus
from schemas import (
    UserLogin, UserRegister, UserResponse, UserUpdate, Token,
    EventCreate, EventUpdate, EventResponse,
    CostCreate, CostUpdate, CostResponse,
    RevenueCreate, RevenueUpdate, RevenueResponse,
    ReceiptUpload, ReceiptUploadResponse, ReceiptResponse, ReceiptOCRResult, OCRItem,
    CreateCostsFromReceipt, CategoriesResponse,
    ChatMessageCreate, ChatMessageResponse, ChatHistoryResponse, ChatUserStatus,
    EventReport, PeriodReport, MessageResponse
)
from security import verify_password, get_password_hash, create_access_token, verify_token


# ==================== APP SETUP ====================

app = FastAPI(
    title="Music Venue Management System",
    description="API do zarządzania finansami klubu muzycznego z live chatem",
    version="2.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


# ==================== WEBSOCKET CONNECTION MANAGER ====================

class ConnectionManager:
    """Manages WebSocket connections for live chat"""
    
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
        self.user_last_seen: Dict[int, datetime] = {}
    
    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        self.user_last_seen[user_id] = datetime.utcnow()
    
    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        self.user_last_seen[user_id] = datetime.utcnow()
    
    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except:
                self.disconnect(user_id)
    
    async def broadcast(self, message: dict):
        disconnected = []
        for user_id, connection in self.active_connections.items():
            try:
                await connection.send_json(message)
            except:
                disconnected.append(user_id)
        for user_id in disconnected:
            self.disconnect(user_id)
    
    def get_online_users(self) -> Set[int]:
        return set(self.active_connections.keys())
    
    def is_online(self, user_id: int) -> bool:
        return user_id in self.active_connections


manager = ConnectionManager()


# ==================== STARTUP ====================

@app.on_event("startup")
async def startup_event():
    Base.metadata.create_all(bind=engine)
    
    db = next(get_db())
    try:
        default_users = [
            {"email": "admin@venue.com", "password": "Admin123!", "full_name": "Administrator", "role": "owner"},
            {"email": "manager@venue.com", "password": "Manager123!", "full_name": "Manager Klubu", "role": "manager"},
            {"email": "worker@venue.com", "password": "Worker123!", "full_name": "Pracownik", "role": "worker"},
        ]
        
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
        
        db.commit()
        print("✅ Default users created")
    except Exception as e:
        print(f"⚠️ Startup: {e}")
    finally:
        db.close()


# ==================== AUTH HELPERS ====================

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Wymagana autoryzacja")
    
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


def require_role(allowed_roles: List[str]):
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Brak uprawnień")
        return current_user
    return role_checker


# ==================== HEALTH CHECK ====================

@app.get("/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.get("/")
def root():
    return {"message": "Music Venue API v2.0", "docs": "/docs", "app": "/app"}


# ==================== AUTH ENDPOINTS ====================

@app.post("/api/auth/login", response_model=Token)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Nieprawidłowy email lub hasło")
    
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Konto nieaktywne")
    
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    
    return Token(
        access_token=access_token,
        user=UserResponse.model_validate(user)
    )


@app.post("/api/auth/register", response_model=Token)
def register(data: UserRegister, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email już zarejestrowany")
    
    user = User(
        email=data.email,
        password_hash=get_password_hash(data.password),
        full_name=data.full_name,
        role=data.role.value
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    
    return Token(
        access_token=access_token,
        user=UserResponse.model_validate(user)
    )


@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


# ==================== USER MANAGEMENT ====================

@app.get("/api/users", response_model=List[UserResponse])
def list_users(
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    users = db.query(User).all()
    return [UserResponse.model_validate(u) for u in users]


@app.put("/api/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    data: UserUpdate,
    current_user: User = Depends(require_role(["owner"])),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    if data.full_name:
        user.full_name = data.full_name
    if data.role:
        user.role = data.role.value
    if data.is_active is not None:
        user.is_active = data.is_active
    
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@app.delete("/api/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: User = Depends(require_role(["owner"])),
    db: Session = Depends(get_db)
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie można usunąć własnego konta")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    db.delete(user)
    db.commit()
    return {"message": "Użytkownik usunięty"}


# ==================== EVENTS ====================

@app.post("/api/events", response_model=EventResponse)
def create_event(
    data: EventCreate,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    event = Event(
        name=data.name,
        description=data.description,
        event_date=data.event_date,
        venue_capacity=data.venue_capacity,
        ticket_price=data.ticket_price,
        created_by=current_user.id
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return EventResponse.model_validate(event)


@app.get("/api/events", response_model=List[EventResponse])
def list_events(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    events = db.query(Event).order_by(Event.event_date.desc()).all()
    return [EventResponse.model_validate(e) for e in events]


@app.get("/api/events/{event_id}", response_model=EventResponse)
def get_event(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    return EventResponse.model_validate(event)


@app.put("/api/events/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    data: EventUpdate,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    
    db.commit()
    db.refresh(event)
    return EventResponse.model_validate(event)


@app.delete("/api/events/{event_id}")
def delete_event(
    event_id: int,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    db.delete(event)
    db.commit()
    return {"message": "Wydarzenie usunięte"}


# ==================== COSTS ====================

@app.post("/api/costs", response_model=CostResponse)
def create_cost(data: CostCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == data.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    cost = Cost(
        event_id=data.event_id,
        category=data.category.value,
        amount=data.amount,
        description=data.description,
        receipt_id=data.receipt_id,
        created_by=current_user.id
    )
    db.add(cost)
    db.commit()
    db.refresh(cost)
    return CostResponse.model_validate(cost)


@app.get("/api/costs/event/{event_id}", response_model=List[CostResponse])
def get_event_costs(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    costs = db.query(Cost).filter(Cost.event_id == event_id).all()
    return [CostResponse.model_validate(c) for c in costs]


@app.put("/api/costs/{cost_id}", response_model=CostResponse)
def update_cost(cost_id: int, data: CostUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Koszt nie znaleziony")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "category" and value:
            value = value.value
        setattr(cost, field, value)
    
    db.commit()
    db.refresh(cost)
    return CostResponse.model_validate(cost)


@app.delete("/api/costs/{cost_id}")
def delete_cost(cost_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Koszt nie znaleziony")
    
    db.delete(cost)
    db.commit()
    return {"message": "Koszt usunięty"}


# ==================== REVENUE ====================

@app.post("/api/revenue", response_model=RevenueResponse)
def create_revenue(data: RevenueCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == data.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    revenue = Revenue(
        event_id=data.event_id,
        source=data.source.value,
        amount=data.amount,
        description=data.description,
        recorded_by=current_user.id
    )
    db.add(revenue)
    db.commit()
    db.refresh(revenue)
    return RevenueResponse.model_validate(revenue)


@app.get("/api/revenue/event/{event_id}", response_model=List[RevenueResponse])
def get_event_revenue(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    revenues = db.query(Revenue).filter(Revenue.event_id == event_id).all()
    return [RevenueResponse.model_validate(r) for r in revenues]


@app.put("/api/revenue/{revenue_id}", response_model=RevenueResponse)
def update_revenue(revenue_id: int, data: RevenueUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    revenue = db.query(Revenue).filter(Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Przychód nie znaleziony")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "source" and value:
            value = value.value
        setattr(revenue, field, value)
    
    db.commit()
    db.refresh(revenue)
    return RevenueResponse.model_validate(revenue)


@app.delete("/api/revenue/{revenue_id}")
def delete_revenue(revenue_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    revenue = db.query(Revenue).filter(Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Przychód nie znaleziony")
    
    db.delete(revenue)
    db.commit()
    return {"message": "Przychód usunięty"}


# ==================== RECEIPT OCR ====================

def simple_ocr_parse(text: str) -> ReceiptOCRResult:
    """Parse receipt text with Polish store recognition"""
    lines = text.strip().split('\n')
    
    # Store patterns
    store_patterns = {
        'biedronka': r'biedronka|jeronimo\s*martins',
        'lidl': r'lidl',
        'zabka': r'[żz]abka|żabka',
        'carrefour': r'carrefour',
        'auchan': r'auchan',
        'kaufland': r'kaufland',
        'makro': r'makro',
        'selgros': r'selgros',
        'lewiatan': r'lewiatan',
        'dino': r'dino\s*(polska)?',
        'netto': r'netto',
        'stokrotka': r'stokrotka',
        'intermarche': r'intermarch[eé]',
        'polo market': r'polo\s*market',
        'mila': r'mila',
        'spolem': r'spo[lł]em',
        'eurocash': r'eurocash',
        'hurtownia': r'hurtownia',
    }
    
    store_name = None
    for name, pattern in store_patterns.items():
        if re.search(pattern, text.lower()):
            store_name = name.title()
            break
    
    # Date pattern
    receipt_date = None
    date_patterns = [
        r'(\d{4}[-./]\d{2}[-./]\d{2})',
        r'(\d{2}[-./]\d{2}[-./]\d{4})',
        r'(\d{2}[-./]\d{2}[-./]\d{2})',
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text)
        if match:
            receipt_date = match.group(1)
            break
    
    # Total amount
    total = None
    total_patterns = [
        r'suma[:\s]*(\d+[.,]\d{2})',
        r'razem[:\s]*(\d+[.,]\d{2})',
        r'do\s*zap[łl]aty[:\s]*(\d+[.,]\d{2})',
        r'total[:\s]*(\d+[.,]\d{2})',
        r'kwota[:\s]*(\d+[.,]\d{2})',
    ]
    for pattern in total_patterns:
        match = re.search(pattern, text.lower())
        if match:
            total = float(match.group(1).replace(',', '.'))
            break
    
    # Parse items
    items = []
    item_pattern = r'([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9\s\-\.]+?)\s+(\d+[.,]\d{2})\s*([A-Z])?'
    
    for line in lines:
        match = re.search(item_pattern, line)
        if match:
            name = match.group(1).strip()
            price = float(match.group(2).replace(',', '.'))
            
            if len(name) > 3 and price > 0 and price < 10000:
                # Auto-categorize
                category = categorize_item(name)
                items.append(OCRItem(name=name, price=price, category=category))
    
    return ReceiptOCRResult(
        store_name=store_name,
        receipt_date=receipt_date,
        items=items,
        total=total
    )


def categorize_item(name: str) -> str:
    """Auto-categorize item based on name"""
    name_lower = name.lower()
    
    alcohol_keywords = ['piwo', 'wino', 'wódka', 'whisky', 'rum', 'gin', 'likier', 'beer', 'vodka', 'alkohol']
    beverage_keywords = ['cola', 'fanta', 'sprite', 'pepsi', 'sok', 'woda', 'napój', 'redbull', 'monster', 'juice']
    food_keywords = ['chipsy', 'orzeszki', 'paluszki', 'ciastka', 'słodycze', 'przekąski', 'kanapk']
    
    for kw in alcohol_keywords:
        if kw in name_lower:
            return 'bar_alcohol'
    
    for kw in beverage_keywords:
        if kw in name_lower:
            return 'bar_beverages'
    
    for kw in food_keywords:
        if kw in name_lower:
            return 'bar_food'
    
    return 'bar_supplies'


@app.post("/api/receipts/upload", response_model=ReceiptUploadResponse)
def upload_receipt(data: ReceiptUpload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Upload and parse receipt OCR text"""
    ocr_result = simple_ocr_parse(data.ocr_text)
    
    receipt_date = None
    if ocr_result.receipt_date:
        try:
            for fmt in ['%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y', '%Y/%m/%d', '%d.%m.%Y']:
                try:
                    receipt_date = datetime.strptime(ocr_result.receipt_date, fmt)
                    break
                except:
                    continue
        except:
            pass
    
    receipt = Receipt(
        store_name=ocr_result.store_name,
        receipt_date=receipt_date,
        total_amount=ocr_result.total,
        ocr_text=data.ocr_text,
        parsed_items=json.dumps([item.model_dump() for item in ocr_result.items]),
        status=ReceiptStatus.PENDING.value,
        uploaded_by=current_user.id
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    
    return ReceiptUploadResponse(
        id=receipt.id,
        store_name=receipt.store_name,
        receipt_date=receipt.receipt_date,
        total_amount=receipt.total_amount,
        ocr_result=ocr_result,
        status=receipt.status,
        created_at=receipt.created_at
    )


@app.get("/api/receipts", response_model=List[ReceiptResponse])
def list_receipts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    receipts = db.query(Receipt).order_by(Receipt.created_at.desc()).all()
    return [ReceiptResponse.model_validate(r) for r in receipts]


@app.post("/api/receipts/{receipt_id}/create-costs")
def create_costs_from_receipt(
    receipt_id: int,
    data: CreateCostsFromReceipt,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create costs from a receipt"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    event = db.query(Event).filter(Event.id == data.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    cost = Cost(
        event_id=data.event_id,
        category=data.category.value,
        amount=receipt.total_amount or 0,
        description=f"Paragon: {receipt.store_name or 'Nieznany sklep'} - {receipt.receipt_date or receipt.created_at}",
        receipt_id=receipt.id,
        created_by=current_user.id
    )
    db.add(cost)
    
    receipt.status = ReceiptStatus.PROCESSED.value
    receipt.processed_by = current_user.id
    receipt.processed_at = datetime.utcnow()
    
    db.commit()
    
    return {"message": "Koszt utworzony z paragonu", "cost_id": cost.id}


# ==================== LIVE CHAT ====================

@app.get("/api/chat/history", response_model=ChatHistoryResponse)
def get_chat_history(
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get chat history and online users"""
    messages = db.query(ChatMessage).order_by(ChatMessage.created_at.desc()).limit(limit).all()
    messages = list(reversed(messages))
    
    # Build response with sender info
    message_responses = []
    for msg in messages:
        sender = db.query(User).filter(User.id == msg.sender_id).first()
        message_responses.append(ChatMessageResponse(
            id=msg.id,
            sender_id=msg.sender_id,
            sender_name=sender.full_name if sender else "Nieznany",
            sender_role=sender.role if sender else "worker",
            content=msg.content,
            message_type=msg.message_type,
            is_read=msg.is_read,
            created_at=msg.created_at
        ))
    
    # Online users
    users = db.query(User).filter(User.is_active == True).all()
    online_users = []
    for user in users:
        online_users.append(ChatUserStatus(
            user_id=user.id,
            full_name=user.full_name,
            role=user.role,
            is_online=manager.is_online(user.id),
            last_seen=manager.user_last_seen.get(user.id)
        ))
    
    # Unread count
    unread = db.query(ChatMessage).filter(
        ChatMessage.is_read == False,
        ChatMessage.sender_id != current_user.id
    ).count()
    
    return ChatHistoryResponse(
        messages=message_responses,
        users_online=online_users,
        total_unread=unread
    )


@app.post("/api/chat/messages", response_model=ChatMessageResponse)
async def send_chat_message(
    data: ChatMessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a chat message (REST fallback)"""
    message = ChatMessage(
        sender_id=current_user.id,
        content=data.content,
        message_type=data.message_type.value
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    
    response = ChatMessageResponse(
        id=message.id,
        sender_id=message.sender_id,
        sender_name=current_user.full_name,
        sender_role=current_user.role,
        content=message.content,
        message_type=message.message_type,
        is_read=message.is_read,
        created_at=message.created_at
    )
    
    # Broadcast via WebSocket
    await manager.broadcast({
        "type": "new_message",
        "data": response.model_dump(mode='json')
    })
    
    return response


@app.post("/api/chat/mark-read")
def mark_messages_read(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mark all messages as read"""
    db.query(ChatMessage).filter(
        ChatMessage.sender_id != current_user.id,
        ChatMessage.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"message": "Wiadomości oznaczone jako przeczytane"}


@app.websocket("/ws/chat/{token}")
async def websocket_chat(websocket: WebSocket, token: str):
    """WebSocket endpoint for real-time chat"""
    # Verify token
    payload = verify_token(token)
    if not payload:
        await websocket.close(code=4001)
        return
    
    user_id = int(payload.get("sub"))
    
    db = next(get_db())
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        await websocket.close(code=4002)
        return
    
    await manager.connect(websocket, user_id)
    
    # Notify others about user online
    await manager.broadcast({
        "type": "user_online",
        "data": {"user_id": user_id, "full_name": user.full_name}
    })
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "message":
                content = data.get("content", "").strip()
                if content and len(content) <= 2000:
                    message = ChatMessage(
                        sender_id=user_id,
                        content=content,
                        message_type="text"
                    )
                    db.add(message)
                    db.commit()
                    db.refresh(message)
                    
                    await manager.broadcast({
                        "type": "new_message",
                        "data": {
                            "id": message.id,
                            "sender_id": user_id,
                            "sender_name": user.full_name,
                            "sender_role": user.role,
                            "content": message.content,
                            "message_type": message.message_type,
                            "is_read": False,
                            "created_at": message.created_at.isoformat()
                        }
                    })
            
            elif data.get("type") == "typing":
                await manager.broadcast({
                    "type": "user_typing",
                    "data": {"user_id": user_id, "full_name": user.full_name}
                })
            
            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        manager.disconnect(user_id)
        await manager.broadcast({
            "type": "user_offline",
            "data": {"user_id": user_id, "full_name": user.full_name}
        })
    except Exception as e:
        manager.disconnect(user_id)
    finally:
        db.close()


# ==================== REPORTS ====================

@app.get("/api/reports/event/{event_id}", response_model=EventReport)
def get_event_report(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    costs = db.query(Cost).filter(Cost.event_id == event_id).all()
    revenues = db.query(Revenue).filter(Revenue.event_id == event_id).all()
    
    total_costs = sum(c.amount for c in costs)
    total_revenue = sum(r.amount for r in revenues)
    net_profit = total_revenue - total_costs
    profit_margin = (net_profit / total_revenue * 100) if total_revenue > 0 else 0
    
    costs_breakdown = {}
    for cost in costs:
        costs_breakdown[cost.category] = costs_breakdown.get(cost.category, 0) + cost.amount
    
    revenue_breakdown = {}
    for rev in revenues:
        revenue_breakdown[rev.source] = revenue_breakdown.get(rev.source, 0) + rev.amount
    
    return EventReport(
        event_id=event.id,
        event_name=event.name,
        event_date=event.event_date,
        total_costs=total_costs,
        total_revenue=total_revenue,
        net_profit=net_profit,
        profit_margin=round(profit_margin, 2),
        costs_breakdown=costs_breakdown,
        revenue_breakdown=revenue_breakdown
    )


@app.get("/api/reports/period", response_model=PeriodReport)
def get_period_report(
    start_date: str,
    end_date: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    try:
        start = datetime.fromisoformat(start_date)
        end = datetime.fromisoformat(end_date)
    except:
        raise HTTPException(status_code=400, detail="Nieprawidłowy format daty")
    
    events = db.query(Event).filter(Event.event_date.between(start, end)).all()
    event_ids = [e.id for e in events]
    
    total_costs = db.query(func.sum(Cost.amount)).filter(Cost.event_id.in_(event_ids)).scalar() or 0
    total_revenue = db.query(func.sum(Revenue.amount)).filter(Revenue.event_id.in_(event_ids)).scalar() or 0
    net_profit = total_revenue - total_costs
    profit_margin = (net_profit / total_revenue * 100) if total_revenue > 0 else 0
    
    return PeriodReport(
        period_from=start,
        period_to=end,
        events_count=len(events),
        total_costs=total_costs,
        total_revenue=total_revenue,
        net_profit=net_profit,
        profit_margin=round(profit_margin, 2)
    )


# ==================== CATEGORIES ====================

@app.get("/api/stats/categories", response_model=CategoriesResponse)
def get_categories(current_user: User = Depends(get_current_user)):
    cost_categories = {
        "bar_alcohol": "🍺 Alkohol (bar)",
        "bar_beverages": "🥤 Napoje (bar)",
        "bar_food": "🍕 Jedzenie (bar)",
        "bar_supplies": "📦 Zaopatrzenie (bar)",
        "artist_fee": "🎤 Honorarium artysty",
        "sound_engineer": "🎚️ Realizator dźwięku",
        "lighting": "💡 Oświetlenie",
        "staff_wages": "👥 Wynagrodzenia",
        "security": "🛡️ Ochrona",
        "cleaning": "🧹 Sprzątanie",
        "utilities": "⚡ Media",
        "rent": "🏠 Wynajem",
        "equipment": "🔧 Sprzęt",
        "marketing": "📢 Marketing",
        "other": "📋 Inne"
    }
    
    revenue_sources = {
        "box_office": "🎫 Sprzedaż biletów",
        "bar_sales": "🍻 Sprzedaż bar",
        "merchandise": "👕 Merchandise",
        "sponsorship": "🤝 Sponsoring",
        "other": "💰 Inne"
    }
    
    return CategoriesResponse(
        cost_categories=cost_categories,
        revenue_sources=revenue_sources
    )


# ==================== FRONTEND SERVING ====================

# Determine frontend path
FRONTEND_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if not os.path.exists(FRONTEND_PATH):
    FRONTEND_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
if not os.path.exists(FRONTEND_PATH):
    FRONTEND_PATH = "/opt/render/project/src/frontend"

print(f"✅ Frontend path: {FRONTEND_PATH}")


@app.get("/app/{full_path:path}")
@app.get("/app")
async def serve_frontend(full_path: str = ""):
    """Serve frontend files"""
    if not os.path.exists(FRONTEND_PATH):
        return HTMLResponse(content="<h1>Frontend not found</h1>", status_code=404)
    
    if not full_path or full_path == "":
        file_path = os.path.join(FRONTEND_PATH, "index.html")
    else:
        file_path = os.path.join(FRONTEND_PATH, full_path)
    
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    
    # SPA fallback
    index_path = os.path.join(FRONTEND_PATH, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    
    return HTMLResponse(content="<h1>File not found</h1>", status_code=404)
