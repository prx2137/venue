"""
Music Venue Management System - FastAPI Backend
With Receipt OCR, Live Chat, Calendar and Event Archive Support
"""

from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, UploadFile, File, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Set
import json
import re
import os
import asyncio
import base64
import httpx

from database import engine, get_db, Base
from models import User, Event, Cost, Revenue, Receipt, ChatMessage
from models import UserRole, CostCategory, RevenueSource, ReceiptStatus
from schemas import (
    UserLogin, UserRegister, UserResponse, UserUpdate, UserCreate, Token,
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
    description="API do zarządzania finansami klubu muzycznego z live chatem i kalendarzem",
    version="3.0.0"
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
async def startup():
    Base.metadata.create_all(bind=engine)
    
    db = next(get_db())
    try:
        # Create default users if not exist
        if not db.query(User).filter(User.email == "admin@venue.com").first():
            users = [
                User(
                    email="admin@venue.com",
                    password_hash=get_password_hash("Admin123!"),
                    full_name="Administrator",
                    role=UserRole.OWNER.value
                ),
                User(
                    email="manager@venue.com",
                    password_hash=get_password_hash("Manager123!"),
                    full_name="Manager Klubu",
                    role=UserRole.MANAGER.value
                ),
                User(
                    email="worker@venue.com",
                    password_hash=get_password_hash("Worker123!"),
                    full_name="Pracownik",
                    role=UserRole.WORKER.value
                ),
            ]
            for user in users:
                db.add(user)
            db.commit()
            print("✅ Default users created")
    finally:
        db.close()


# ==================== AUTH HELPERS ====================

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Brak autoryzacji")
    
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Nieprawidłowy token")
    
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Użytkownik nieaktywny")
    
    return user


def require_role(*roles):
    def checker(user: User = Depends(get_current_user)):
        if user.role not in [r.value for r in roles]:
            raise HTTPException(status_code=403, detail="Brak uprawnień")
        return user
    return checker


# ==================== STATIC FILES ====================

@app.get("/app/{path:path}")
async def serve_frontend(path: str = ""):
    base_path = "/app/frontend" if os.path.exists("/app/frontend") else "frontend"
    
    if not path or path == "":
        return FileResponse(f"{base_path}/index.html")
    
    file_path = f"{base_path}/{path}"
    if os.path.exists(file_path):
        return FileResponse(file_path)
    
    return FileResponse(f"{base_path}/index.html")


@app.get("/", response_class=HTMLResponse)
async def root():
    return """
    <html>
        <head>
            <meta http-equiv="refresh" content="0; url=/app" />
            <title>Music Venue</title>
        </head>
        <body>
            <p>Redirecting to <a href="/app">application</a>...</p>
        </body>
    </html>
    """


# ==================== AUTH ENDPOINTS ====================

@app.post("/api/auth/login", response_model=Token)
async def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Nieprawidłowy email lub hasło")
    
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Konto nieaktywne")
    
    token = create_access_token({"sub": user.id, "email": user.email, "role": user.role})
    
    return Token(
        access_token=token,
        token_type="bearer",
        user=UserResponse(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active
        )
    )


@app.get("/api/auth/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active
    )


# ==================== USER MANAGEMENT ====================

@app.get("/api/users", response_model=List[UserResponse])
async def list_users(
    user: User = Depends(require_role(UserRole.OWNER, UserRole.MANAGER)),
    db: Session = Depends(get_db)
):
    """List all users (managers see workers only, owners see all)"""
    if user.role == UserRole.OWNER.value:
        users = db.query(User).all()
    else:
        users = db.query(User).filter(User.role == UserRole.WORKER.value).all()
    
    return [UserResponse(
        id=u.id,
        email=u.email,
        full_name=u.full_name,
        role=u.role,
        is_active=u.is_active
    ) for u in users]


@app.post("/api/users", response_model=UserResponse)
async def create_user(
    data: UserCreate,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.MANAGER)),
    db: Session = Depends(get_db)
):
    """Create a new user"""
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email już istnieje")
    
    if user.role == UserRole.MANAGER.value and data.role != UserRole.WORKER.value:
        raise HTTPException(status_code=403, detail="Manager może tworzyć tylko pracowników")
    
    new_user = User(
        email=data.email,
        password_hash=get_password_hash(data.password),
        full_name=data.full_name,
        role=data.role,
        is_active=True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return UserResponse(
        id=new_user.id,
        email=new_user.email,
        full_name=new_user.full_name,
        role=new_user.role,
        is_active=new_user.is_active
    )


@app.put("/api/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    data: UserUpdate,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.MANAGER)),
    db: Session = Depends(get_db)
):
    """Update a user"""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    if user.role == UserRole.MANAGER.value:
        if target.role != UserRole.WORKER.value:
            raise HTTPException(status_code=403, detail="Brak uprawnień do edycji tego użytkownika")
        if data.role and data.role != UserRole.WORKER.value:
            raise HTTPException(status_code=403, detail="Manager nie może zmienić roli na inną niż pracownik")
    
    if data.email:
        existing = db.query(User).filter(User.email == data.email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email już istnieje")
        target.email = data.email
    
    if data.full_name:
        target.full_name = data.full_name
    if data.role:
        target.role = data.role
    if data.password:
        target.password_hash = get_password_hash(data.password)
    if data.is_active is not None:
        target.is_active = data.is_active
    
    db.commit()
    db.refresh(target)
    
    return UserResponse(
        id=target.id,
        email=target.email,
        full_name=target.full_name,
        role=target.role,
        is_active=target.is_active
    )


@app.delete("/api/users/{user_id}")
async def delete_user(
    user_id: int,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.MANAGER)),
    db: Session = Depends(get_db)
):
    """Delete a user"""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    if target.id == user.id:
        raise HTTPException(status_code=400, detail="Nie można usunąć własnego konta")
    
    if user.role == UserRole.MANAGER.value and target.role != UserRole.WORKER.value:
        raise HTTPException(status_code=403, detail="Brak uprawnień do usunięcia tego użytkownika")
    
    db.delete(target)
    db.commit()
    
    return {"message": "Użytkownik usunięty"}


# ==================== EVENTS ====================

@app.get("/api/events", response_model=List[EventResponse])
async def list_events(
    year: Optional[int] = None,
    month: Optional[int] = None,
    archived: Optional[bool] = None,
    upcoming: Optional[bool] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List events with optional filters"""
    query = db.query(Event)
    
    # Filter by year
    if year:
        query = query.filter(extract('year', Event.event_date) == year)
    
    # Filter by month
    if month:
        query = query.filter(extract('month', Event.event_date) == month)
    
    # Filter archived (past events)
    if archived is True:
        query = query.filter(Event.event_date < datetime.utcnow())
    elif archived is False:
        query = query.filter(Event.event_date >= datetime.utcnow())
    
    # Filter upcoming only
    if upcoming is True:
        query = query.filter(Event.event_date >= datetime.utcnow())
    
    events = query.order_by(Event.event_date.desc()).all()
    
    return [EventResponse(
        id=e.id,
        name=e.name,
        description=e.description,
        event_date=e.event_date,
        venue_capacity=e.venue_capacity,
        ticket_price=e.ticket_price,
        created_by=e.created_by,
        created_at=e.created_at,
        is_past=e.event_date < datetime.utcnow()
    ) for e in events]


@app.get("/api/events/calendar")
async def get_calendar_events(
    year: int,
    month: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get events for calendar view"""
    events = db.query(Event).filter(
        extract('year', Event.event_date) == year,
        extract('month', Event.event_date) == month
    ).all()
    
    return [{
        "id": e.id,
        "name": e.name,
        "date": e.event_date.strftime("%Y-%m-%d"),
        "day": e.event_date.day,
        "is_past": e.event_date < datetime.utcnow()
    } for e in events]


@app.get("/api/events/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    return EventResponse(
        id=event.id,
        name=event.name,
        description=event.description,
        event_date=event.event_date,
        venue_capacity=event.venue_capacity,
        ticket_price=event.ticket_price,
        created_by=event.created_by,
        created_at=event.created_at,
        is_past=event.event_date < datetime.utcnow()
    )


@app.post("/api/events", response_model=EventResponse)
async def create_event(
    data: EventCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = Event(
        name=data.name,
        description=data.description,
        event_date=data.event_date,
        venue_capacity=data.venue_capacity or 0,
        ticket_price=data.ticket_price or 0.0,
        created_by=user.id
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    
    return EventResponse(
        id=event.id,
        name=event.name,
        description=event.description,
        event_date=event.event_date,
        venue_capacity=event.venue_capacity,
        ticket_price=event.ticket_price,
        created_by=event.created_by,
        created_at=event.created_at,
        is_past=event.event_date < datetime.utcnow()
    )


@app.put("/api/events/{event_id}", response_model=EventResponse)
async def update_event(
    event_id: int,
    data: EventUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    if data.name:
        event.name = data.name
    if data.description is not None:
        event.description = data.description
    if data.event_date:
        event.event_date = data.event_date
    if data.venue_capacity is not None:
        event.venue_capacity = data.venue_capacity
    if data.ticket_price is not None:
        event.ticket_price = data.ticket_price
    
    db.commit()
    db.refresh(event)
    
    return EventResponse(
        id=event.id,
        name=event.name,
        description=event.description,
        event_date=event.event_date,
        venue_capacity=event.venue_capacity,
        ticket_price=event.ticket_price,
        created_by=event.created_by,
        created_at=event.created_at,
        is_past=event.event_date < datetime.utcnow()
    )


@app.delete("/api/events/{event_id}")
async def delete_event(
    event_id: int,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.MANAGER)),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    db.delete(event)
    db.commit()
    
    return {"message": "Wydarzenie usunięte"}


# ==================== DASHBOARD STATS ====================

@app.get("/api/stats/dashboard")
async def get_dashboard_stats(
    year: Optional[int] = None,
    month: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get dashboard statistics with optional date filters"""
    
    # Base queries
    events_query = db.query(Event)
    costs_query = db.query(Cost)
    revenues_query = db.query(Revenue)
    
    # Apply date filters via events
    if year or month:
        if year:
            events_query = events_query.filter(extract('year', Event.event_date) == year)
        if month:
            events_query = events_query.filter(extract('month', Event.event_date) == month)
        
        # Get filtered event IDs
        event_ids = [e.id for e in events_query.all()]
        
        if event_ids:
            costs_query = costs_query.filter(Cost.event_id.in_(event_ids))
            revenues_query = revenues_query.filter(Revenue.event_id.in_(event_ids))
        else:
            # No events in period
            return {
                "events_count": 0,
                "total_costs": 0,
                "total_revenue": 0,
                "net_profit": 0,
                "upcoming_events": 0,
                "past_events": 0,
                "costs_by_category": {},
                "revenue_by_source": {}
            }
    
    events_count = events_query.count()
    upcoming_events = events_query.filter(Event.event_date >= datetime.utcnow()).count()
    past_events = events_query.filter(Event.event_date < datetime.utcnow()).count()
    
    total_costs = costs_query.with_entities(func.sum(Cost.amount)).scalar() or 0
    total_revenue = revenues_query.with_entities(func.sum(Revenue.amount)).scalar() or 0
    
    # Group by category
    costs_by_category = {}
    for category, amount in costs_query.with_entities(Cost.category, func.sum(Cost.amount)).group_by(Cost.category).all():
        costs_by_category[category] = amount or 0
    
    revenue_by_source = {}
    for source, amount in revenues_query.with_entities(Revenue.source, func.sum(Revenue.amount)).group_by(Revenue.source).all():
        revenue_by_source[source] = amount or 0
    
    return {
        "events_count": events_count,
        "total_costs": total_costs,
        "total_revenue": total_revenue,
        "net_profit": total_revenue - total_costs,
        "upcoming_events": upcoming_events,
        "past_events": past_events,
        "costs_by_category": costs_by_category,
        "revenue_by_source": revenue_by_source
    }


@app.get("/api/stats/categories")
async def get_categories(user: User = Depends(get_current_user)):
    return CategoriesResponse(
        cost_categories=[c.value for c in CostCategory],
        revenue_sources=[r.value for r in RevenueSource]
    )


@app.get("/api/stats/available-periods")
async def get_available_periods(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of years and months that have events"""
    events = db.query(
        extract('year', Event.event_date).label('year'),
        extract('month', Event.event_date).label('month')
    ).distinct().order_by(
        extract('year', Event.event_date).desc(),
        extract('month', Event.event_date).desc()
    ).all()
    
    periods = []
    for year, month in events:
        periods.append({
            "year": int(year),
            "month": int(month),
            "label": f"{int(month):02d}/{int(year)}"
        })
    
    # Get unique years
    years = sorted(set(p["year"] for p in periods), reverse=True)
    
    return {
        "periods": periods,
        "years": years
    }


# ==================== COSTS ====================

@app.get("/api/costs/event/{event_id}", response_model=List[CostResponse])
async def list_event_costs(
    event_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    costs = db.query(Cost).filter(Cost.event_id == event_id).all()
    return [CostResponse(
        id=c.id,
        event_id=c.event_id,
        category=c.category,
        amount=c.amount,
        description=c.description,
        receipt_id=c.receipt_id,
        created_by=c.created_by,
        created_at=c.created_at
    ) for c in costs]


@app.post("/api/costs", response_model=CostResponse)
async def create_cost(
    data: CostCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cost = Cost(
        event_id=data.event_id,
        category=data.category,
        amount=data.amount,
        description=data.description,
        receipt_id=data.receipt_id,
        created_by=user.id
    )
    db.add(cost)
    db.commit()
    db.refresh(cost)
    
    return CostResponse(
        id=cost.id,
        event_id=cost.event_id,
        category=cost.category,
        amount=cost.amount,
        description=cost.description,
        receipt_id=cost.receipt_id,
        created_by=cost.created_by,
        created_at=cost.created_at
    )


@app.put("/api/costs/{cost_id}", response_model=CostResponse)
async def update_cost(
    cost_id: int,
    data: CostUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Koszt nie znaleziony")
    
    if data.category:
        cost.category = data.category
    if data.amount is not None:
        cost.amount = data.amount
    if data.description is not None:
        cost.description = data.description
    
    db.commit()
    db.refresh(cost)
    
    return CostResponse(
        id=cost.id,
        event_id=cost.event_id,
        category=cost.category,
        amount=cost.amount,
        description=cost.description,
        receipt_id=cost.receipt_id,
        created_by=cost.created_by,
        created_at=cost.created_at
    )


@app.delete("/api/costs/{cost_id}")
async def delete_cost(
    cost_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Koszt nie znaleziony")
    
    db.delete(cost)
    db.commit()
    
    return {"message": "Koszt usunięty"}


# ==================== REVENUES ====================

@app.get("/api/revenue/event/{event_id}", response_model=List[RevenueResponse])
async def list_event_revenues(
    event_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    revenues = db.query(Revenue).filter(Revenue.event_id == event_id).all()
    return [RevenueResponse(
        id=r.id,
        event_id=r.event_id,
        source=r.source,
        amount=r.amount,
        description=r.description,
        recorded_by=r.recorded_by,
        created_at=r.created_at
    ) for r in revenues]


@app.post("/api/revenue", response_model=RevenueResponse)
async def create_revenue(
    data: RevenueCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    revenue = Revenue(
        event_id=data.event_id,
        source=data.source,
        amount=data.amount,
        description=data.description,
        recorded_by=user.id
    )
    db.add(revenue)
    db.commit()
    db.refresh(revenue)
    
    return RevenueResponse(
        id=revenue.id,
        event_id=revenue.event_id,
        source=revenue.source,
        amount=revenue.amount,
        description=revenue.description,
        recorded_by=revenue.recorded_by,
        created_at=revenue.created_at
    )


@app.put("/api/revenue/{revenue_id}", response_model=RevenueResponse)
async def update_revenue(
    revenue_id: int,
    data: RevenueUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    revenue = db.query(Revenue).filter(Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Przychód nie znaleziony")
    
    if data.source:
        revenue.source = data.source
    if data.amount is not None:
        revenue.amount = data.amount
    if data.description is not None:
        revenue.description = data.description
    
    db.commit()
    db.refresh(revenue)
    
    return RevenueResponse(
        id=revenue.id,
        event_id=revenue.event_id,
        source=revenue.source,
        amount=revenue.amount,
        description=revenue.description,
        recorded_by=revenue.recorded_by,
        created_at=revenue.created_at
    )


@app.delete("/api/revenue/{revenue_id}")
async def delete_revenue(
    revenue_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    revenue = db.query(Revenue).filter(Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Przychód nie znaleziony")
    
    db.delete(revenue)
    db.commit()
    
    return {"message": "Przychód usunięty"}


# ==================== REPORTS ====================

@app.get("/api/reports/event/{event_id}", response_model=EventReport)
async def get_event_report(
    event_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Wydarzenie nie znalezione")
    
    costs = db.query(Cost).filter(Cost.event_id == event_id).all()
    revenues = db.query(Revenue).filter(Revenue.event_id == event_id).all()
    
    total_costs = sum(c.amount for c in costs)
    total_revenue = sum(r.amount for r in revenues)
    
    costs_by_category = {}
    for c in costs:
        costs_by_category[c.category] = costs_by_category.get(c.category, 0) + c.amount
    
    revenue_by_source = {}
    for r in revenues:
        revenue_by_source[r.source] = revenue_by_source.get(r.source, 0) + r.amount
    
    return EventReport(
        event_id=event.id,
        event_name=event.name,
        event_date=event.event_date,
        total_costs=total_costs,
        total_revenue=total_revenue,
        net_profit=total_revenue - total_costs,
        costs_by_category=costs_by_category,
        revenue_by_source=revenue_by_source
    )


# ==================== RECEIPT OCR ====================

def simple_ocr_parse(text: str) -> ReceiptOCRResult:
    """Parse receipt text with improved Polish store recognition"""
    lines = text.strip().split('\n')
    text_lower = text.lower()
    
    # Store patterns - more comprehensive
    store_patterns = {
        'biedronka': r'biedronka|jeronimo\s*martins|jm\s*s\.?a\.?',
        'lidl': r'lidl',
        'zabka': r'[żz]abka|żabka|zabka',
        'carrefour': r'carrefour',
        'auchan': r'auchan',
        'kaufland': r'kaufland',
        'makro': r'makro|metro\s*ag',
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
        'orlen': r'orlen|pkn|stacja\s*paliw',
        'rossmann': r'rossmann',
        'pepco': r'pepco',
        'action': r'action',
        'tesco': r'tesco',
        'delikatesy centrum': r'delikatesy\s*centrum',
        'abc': r'abc\s*(na\s*kołach)?',
        'freshmarket': r'fresh\s*market',
        'groszek': r'groszek',
        'społem': r'spo[lł]em',
        'topaz': r'topaz',
        'chata polska': r'chata\s*polska',
    }
    
    store_name = None
    for name, pattern in store_patterns.items():
        if re.search(pattern, text_lower):
            store_name = name.title()
            break
    
    # Date patterns - multiple formats
    receipt_date = None
    date_patterns = [
        r'(\d{4}[-./]\d{2}[-./]\d{2})',          # 2024-01-15
        r'(\d{2}[-./]\d{2}[-./]\d{4})',          # 15-01-2024
        r'(\d{2}[-./]\d{2}[-./]\d{2})\b',        # 15-01-24
        r'data[:\s]*(\d{2}[-./]\d{2}[-./]\d{4})',  # Data: 15-01-2024
        r'(\d{2}\.\d{2}\.\d{4})',                # 15.01.2024
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text)
        if match:
            receipt_date = match.group(1)
            break
    
    # Total amount - IMPROVED PATTERNS for Polish receipts
    total = None
    total_patterns = [
        # Polish patterns - very common
        r'suma\s*pln[:\s]*(\d+[.,]\d{2})',
        r'suma[:\s]+(\d+[.,]\d{2})',
        r'suma\s*(\d+[.,]\d{2})',
        r'razem[:\s]+(\d+[.,]\d{2})',
        r'razem\s+pln[:\s]*(\d+[.,]\d{2})',
        r'razem\s*(\d+[.,]\d{2})',
        r'do\s*zap[łl]aty[:\s]*(\d+[.,]\d{2})',
        r'do\s*zaplaty[:\s]*(\d+[.,]\d{2})',
        r'zap[łl]acono[:\s]*(\d+[.,]\d{2})',
        r'zaplacono[:\s]*(\d+[.,]\d{2})',
        r'nale[żz]no[śs][ćc][:\s]*(\d+[.,]\d{2})',
        r'naleznosc[:\s]*(\d+[.,]\d{2})',
        r'warto[śs][ćc]\s*brutto[:\s]*(\d+[.,]\d{2})',
        r'wartosc\s*brutto[:\s]*(\d+[.,]\d{2})',
        r'brutto[:\s]*(\d+[.,]\d{2})',
        r'total[:\s]*(\d+[.,]\d{2})',
        r'kwota[:\s]*(\d+[.,]\d{2})',
        r'sprzeda[żz]\s*op[:\s]*(\d+[.,]\d{2})',
        r'warto[śs][ćc][:\s]*(\d+[.,]\d{2})',
        # PTU/VAT summary patterns
        r'ptu\s*[a-e]?\s*\d+[%]?[:\s]*\d+[.,]\d{2}[:\s]*(\d+[.,]\d{2})',
        # Patterns with PLN/zł suffix
        r'(\d+[.,]\d{2})\s*pln\s*$',
        r'(\d+[.,]\d{2})\s*z[łl]\s*$',
        # Last line with number pattern (fallback)
        r'\*+\s*(\d+[.,]\d{2})',
    ]
    
    for pattern in total_patterns:
        match = re.search(pattern, text_lower)
        if match:
            try:
                total = float(match.group(1).replace(',', '.'))
                if total > 0:
                    break
            except:
                continue
    
    # If still no total, look for the largest reasonable amount
    if total is None:
        amounts = re.findall(r'(\d+[.,]\d{2})', text)
        if amounts:
            amounts_float = []
            for a in amounts:
                try:
                    val = float(a.replace(',', '.'))
                    if 1 < val < 100000:  # Reasonable range
                        amounts_float.append(val)
                except:
                    continue
            if amounts_float:
                # Take the largest amount as likely total
                total = max(amounts_float)
    
    # Parse items
    items = []
    item_pattern = r'([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż0-9\s\-\.]+?)\s+(\d+[.,]\d{2})\s*([A-Z])?'
    
    for line in lines:
        match = re.search(item_pattern, line)
        if match:
            name = match.group(1).strip()
            try:
                price = float(match.group(2).replace(',', '.'))
            except:
                continue
            
            # Filter out totals and tax lines
            skip_words = ['suma', 'razem', 'total', 'ptu', 'vat', 'gotówka', 'gotowka', 
                         'karta', 'reszta', 'zapłacono', 'zaplacono', 'sprzedaż']
            if any(w in name.lower() for w in skip_words):
                continue
            
            if len(name) > 2 and price > 0 and price < 10000:
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
    
    alcohol_keywords = ['wódka', 'wodka', 'piwo', 'wino', 'whisky', 'rum', 'gin', 
                       'tequila', 'likier', 'brandy', 'koniak', 'szampan', 'prosecco',
                       'beer', 'wine', 'vodka', 'bols', 'finlandia', 'absolut', 
                       'smirnoff', 'ballantine', 'jameson', 'jack daniel', 'heineken',
                       'tyskie', 'żywiec', 'zywiec', 'lech', 'perła', 'perla', 'okocim']
    
    beverage_keywords = ['cola', 'pepsi', 'sprite', 'fanta', 'sok', 'juice', 
                        'woda', 'water', 'napój', 'napoj', 'red bull', 'monster',
                        'tonic', 'schweppes', 'lipton', 'nestea', 'oranżada',
                        'lemoniada', 'ice tea', 'tiger', 'burn']
    
    food_keywords = ['kanapka', 'pizza', 'burger', 'frytki', 'chipsy', 'orzeszki',
                    'paluszki', 'czekolada', 'cukierki', 'przekąska', 'przekaska',
                    'snack', 'sandwich', 'chleb', 'bulka', 'bułka', 'ser', 'szynka',
                    'salami', 'kielbasa', 'kiełbasa', 'hot dog', 'nachos']
    
    supply_keywords = ['kubek', 'talerz', 'serwetka', 'sztućce', 'sztucce', 
                      'słomka', 'slomka', 'folia', 'rękawice', 'rekawice',
                      'środek', 'srodek', 'czyściwo', 'papier', 'torba', 'reklamówka',
                      'mydło', 'mydlo', 'ręcznik', 'recznik', 'kosz', 'worek']
    
    if any(k in name_lower for k in alcohol_keywords):
        return CostCategory.BAR_ALCOHOL.value
    elif any(k in name_lower for k in beverage_keywords):
        return CostCategory.BAR_BEVERAGES.value
    elif any(k in name_lower for k in food_keywords):
        return CostCategory.BAR_FOOD.value
    elif any(k in name_lower for k in supply_keywords):
        return CostCategory.BAR_SUPPLIES.value
    else:
        return CostCategory.OTHER.value


# OCR API configuration
OCR_API_KEY = os.environ.get("OCR_API_KEY", "K82925827188957")
OCR_API_URL = "https://api.ocr.space/parse/image"


async def perform_ocr(image_base64: str, mime_type: str) -> Optional[str]:
    """Send image to OCR.space API and get text"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            data_uri = f"data:{mime_type};base64,{image_base64}"
            
            response = await client.post(
                OCR_API_URL,
                data={
                    "apikey": OCR_API_KEY,
                    "base64Image": data_uri,
                    "language": "pol",  # Polish
                    "isOverlayRequired": False,
                    "OCREngine": "2",  # Better for receipts
                    "scale": True,
                    "isTable": False,
                },
            )
            
            result = response.json()
            
            if result.get("IsErroredOnProcessing"):
                print(f"OCR Error: {result.get('ErrorMessage')}")
                return None
            
            parsed_results = result.get("ParsedResults", [])
            if parsed_results:
                return parsed_results[0].get("ParsedText", "")
            
    except Exception as e:
        print(f"OCR API Error: {e}")
    
    return None


@app.post("/api/receipts/upload-image", response_model=ReceiptUploadResponse)
async def upload_receipt_image(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload receipt image, perform OCR, and parse data"""
    
    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/jpg", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Dozwolone tylko pliki JPG, PNG, WEBP")
    
    # Read and encode image
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="Plik za duży (max 10MB)")
    
    image_base64 = base64.b64encode(contents).decode('utf-8')
    
    # Perform OCR
    ocr_text = await perform_ocr(image_base64, file.content_type)
    
    if not ocr_text:
        # Store image even if OCR failed - can be manually reviewed
        ocr_text = "(OCR nie rozpoznał tekstu - sprawdź ręcznie)"
    
    # Parse the OCR result
    parsed = simple_ocr_parse(ocr_text)
    
    # Create receipt record with image
    receipt = Receipt(
        store_name=parsed.store_name,
        receipt_date=datetime.strptime(parsed.receipt_date, "%d.%m.%Y") if parsed.receipt_date and '.' in parsed.receipt_date else (
            datetime.strptime(parsed.receipt_date, "%d-%m-%Y") if parsed.receipt_date and '-' in parsed.receipt_date else datetime.utcnow()
        ),
        total_amount=parsed.total,
        ocr_text=ocr_text,
        parsed_items=json.dumps([item.dict() for item in parsed.items], ensure_ascii=False),
        image_data=image_base64,
        image_mime_type=file.content_type,
        status=ReceiptStatus.PENDING.value,
        uploaded_by=user.id
    )
    
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    
    return ReceiptUploadResponse(
        id=receipt.id,
        store_name=parsed.store_name,
        receipt_date=parsed.receipt_date,
        total_amount=parsed.total,
        items=parsed.items,
        status=receipt.status,
        message="Paragon przesłany i przetworzony przez OCR",
        has_image=True
    )


@app.post("/api/receipts/upload", response_model=ReceiptUploadResponse)
async def upload_receipt_text(
    data: ReceiptUpload,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload and parse receipt OCR text (legacy - text only)"""
    parsed = simple_ocr_parse(data.ocr_text)
    
    receipt = Receipt(
        store_name=parsed.store_name,
        receipt_date=datetime.strptime(parsed.receipt_date, "%d.%m.%Y") if parsed.receipt_date and '.' in parsed.receipt_date else (
            datetime.strptime(parsed.receipt_date, "%d-%m-%Y") if parsed.receipt_date and '-' in parsed.receipt_date else datetime.utcnow()
        ),
        total_amount=parsed.total,
        ocr_text=data.ocr_text,
        parsed_items=json.dumps([item.dict() for item in parsed.items], ensure_ascii=False),
        status=ReceiptStatus.PENDING.value,
        uploaded_by=user.id
    )
    
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    
    return ReceiptUploadResponse(
        id=receipt.id,
        store_name=parsed.store_name,
        receipt_date=parsed.receipt_date,
        total_amount=parsed.total,
        items=parsed.items,
        status=receipt.status,
        message="Paragon przesłany i przetworzony",
        has_image=False
    )


@app.get("/api/receipts", response_model=List[ReceiptResponse])
async def list_receipts(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    receipts = db.query(Receipt).order_by(Receipt.created_at.desc()).all()
    
    # Workers can only see their own receipts
    if user.role == UserRole.WORKER.value:
        receipts = [r for r in receipts if r.uploaded_by == user.id]
    
    return [ReceiptResponse(
        id=r.id,
        store_name=r.store_name,
        receipt_date=r.receipt_date,
        total_amount=r.total_amount,
        status=r.status,
        uploaded_by=r.uploaded_by,
        uploader_name=r.uploader.full_name if r.uploader else None,
        created_at=r.created_at,
        has_image=bool(r.image_data)
    ) for r in receipts]


@app.get("/api/receipts/{receipt_id}")
async def get_receipt_detail(
    receipt_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get receipt details including OCR text"""
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    # Workers can only see their own receipts
    if user.role == UserRole.WORKER.value and receipt.uploaded_by != user.id:
        raise HTTPException(status_code=403, detail="Brak dostępu do tego paragonu")
    
    return {
        "id": receipt.id,
        "store_name": receipt.store_name,
        "receipt_date": receipt.receipt_date,
        "total_amount": receipt.total_amount,
        "ocr_text": receipt.ocr_text,
        "parsed_items": json.loads(receipt.parsed_items) if receipt.parsed_items else [],
        "status": receipt.status,
        "uploaded_by": receipt.uploaded_by,
        "uploader_name": receipt.uploader.full_name if receipt.uploader else None,
        "created_at": receipt.created_at,
        "has_image": bool(receipt.image_data)
    }


@app.get("/api/receipts/{receipt_id}/image")
async def get_receipt_image(
    receipt_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db)
):
    """Get receipt image (managers and owners only)"""
    # Verify token
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Nieprawidłowy token")
    
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=401, detail="Użytkownik nie znaleziony")
    
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    # Only managers and owners can view images
    if user.role == UserRole.WORKER.value:
        raise HTTPException(status_code=403, detail="Brak uprawnień do podglądu zdjęć paragonów")
    
    if not receipt.image_data:
        raise HTTPException(status_code=404, detail="Paragon nie ma zdjęcia")
    
    image_bytes = base64.b64decode(receipt.image_data)
    return Response(content=image_bytes, media_type=receipt.image_mime_type or "image/jpeg")


@app.delete("/api/receipts/{receipt_id}")
async def delete_receipt(
    receipt_id: int,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.MANAGER)),
    db: Session = Depends(get_db)
):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    db.delete(receipt)
    db.commit()
    
    return {"message": "Paragon usunięty"}


# ==================== LIVE CHAT ====================

@app.websocket("/ws/chat/{token}")
async def websocket_chat(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    """WebSocket endpoint for live chat"""
    # Verify token
    payload = verify_token(token)
    if not payload:
        await websocket.close(code=4001)
        return
    
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user:
        await websocket.close(code=4001)
        return
    
    await manager.connect(websocket, user.id)
    
    try:
        # Notify others user is online
        await manager.broadcast({
            "type": "user_status",
            "user_id": user.id,
            "user_name": user.full_name,
            "status": "online"
        })
        
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "message":
                # Save message to database
                message = ChatMessage(
                    sender_id=user.id,
                    content=data.get("content", ""),
                    message_type="text"
                )
                db.add(message)
                db.commit()
                db.refresh(message)
                
                # Broadcast to all connected users
                await manager.broadcast({
                    "type": "message",
                    "id": message.id,
                    "sender_id": user.id,
                    "sender_name": user.full_name,
                    "sender_role": user.role,
                    "content": message.content,
                    "created_at": message.created_at.isoformat()
                })
            
            elif data.get("type") == "typing":
                # Broadcast typing indicator
                await manager.broadcast({
                    "type": "typing",
                    "user_id": user.id,
                    "user_name": user.full_name,
                    "is_typing": data.get("is_typing", False)
                })
    
    except WebSocketDisconnect:
        manager.disconnect(user.id)
        await manager.broadcast({
            "type": "user_status",
            "user_id": user.id,
            "user_name": user.full_name,
            "status": "offline"
        })


@app.get("/api/chat/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get recent chat messages"""
    messages = db.query(ChatMessage).order_by(ChatMessage.created_at.desc()).limit(limit).all()
    messages.reverse()  # Oldest first
    
    return ChatHistoryResponse(
        messages=[ChatMessageResponse(
            id=m.id,
            sender_id=m.sender_id,
            sender_name=m.sender.full_name if m.sender else "Nieznany",
            sender_role=m.sender.role if m.sender else "worker",
            content=m.content,
            message_type=m.message_type,
            created_at=m.created_at
        ) for m in messages]
    )


@app.post("/api/chat/messages", response_model=ChatMessageResponse)
async def send_chat_message(
    data: ChatMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a chat message (REST fallback)"""
    message = ChatMessage(
        sender_id=user.id,
        content=data.content,
        message_type=data.message_type or "text"
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    
    # Broadcast via WebSocket
    await manager.broadcast({
        "type": "message",
        "id": message.id,
        "sender_id": user.id,
        "sender_name": user.full_name,
        "sender_role": user.role,
        "content": message.content,
        "created_at": message.created_at.isoformat()
    })
    
    return ChatMessageResponse(
        id=message.id,
        sender_id=message.sender_id,
        sender_name=user.full_name,
        sender_role=user.role,
        content=message.content,
        message_type=message.message_type,
        created_at=message.created_at
    )


@app.get("/api/chat/users/online")
async def get_online_users(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get list of online users"""
    online_ids = manager.get_online_users()
    users = db.query(User).filter(User.id.in_(online_ids)).all() if online_ids else []
    
    return [ChatUserStatus(
        user_id=u.id,
        user_name=u.full_name,
        role=u.role,
        is_online=True
    ) for u in users]


@app.post("/api/chat/mark-read")
async def mark_messages_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mark all messages as read for current user"""
    db.query(ChatMessage).filter(
        ChatMessage.sender_id != user.id,
        ChatMessage.is_read == False
    ).update({"is_read": True})
    db.commit()
    return {"message": "Wiadomości oznaczone jako przeczytane"}


# Mount static files last
if os.path.exists("/app/frontend"):
    app.mount("/static", StaticFiles(directory="/app/frontend"), name="static")
elif os.path.exists("frontend"):
    app.mount("/static", StaticFiles(directory="frontend"), name="static")
