"""
Music Venue Management System - FastAPI Backend
With Events, Line-up, Technical Riders, Receipt OCR and Live Chat
"""

from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, UploadFile, File, Response, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Set
import json
import re
import os
import asyncio
import base64

from database import engine, get_db, Base
from models import User, Event, Cost, Revenue, Receipt, ChatMessage, PrivateMessage, StaffPosition, LineupEntry
from models import UserRole, CostCategory, RevenueSource, ReceiptStatus, DEFAULT_POSITIONS
from schemas import (
    LoginRequest, TokenResponse, UserRegister, UserResponse, UserUpdate, UserCreate,
    EventCreate, EventUpdate, EventResponse, EventCalendarResponse,
    LineupEntryCreate, LineupEntryUpdate, LineupEntryResponse,
    CostCreate, CostUpdate, CostResponse,
    RevenueCreate, RevenueUpdate, RevenueResponse,
    ReceiptResponse, ReceiptToCost,
    ChatMessageCreate, ChatMessageResponse,
    PrivateMessageCreate, PrivateMessageResponse, ConversationResponse,
    PositionUpdate, SoundNotificationUpdate,
    StaffPositionCreate, StaffPositionUpdate, StaffPositionResponse,
    DashboardStats, EventReport
)
from security import verify_password, get_password_hash, create_access_token, verify_token


# ==================== APP SETUP ====================

app = FastAPI(
    title="Music Venue Management System",
    description="API do zarządzania eventami klubu muzycznego z line-upem i riderami",
    version="3.0.0"
)

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
    print("✅ Database tables created")
    
    # Create default data
    db = next(get_db())
    try:
        # Create default positions
        existing_positions = db.query(StaffPosition).first()
        if not existing_positions:
            for pos_data in DEFAULT_POSITIONS:
                pos = StaffPosition(**pos_data)
                db.add(pos)
            # Add default "brak" position
            brak = StaffPosition(code="brak", name="Brak stanowiska", description="Nie przypisano stanowiska")
            db.add(brak)
            db.commit()
            print("✅ Default positions created")
        
        # Create default users
        existing_owner = db.query(User).filter(User.role == "owner").first()
        if not existing_owner:
            owner = User(
                email="admin@venue.com",
                password_hash=get_password_hash("Admin123!"),
                full_name="Administrator",
                role="owner",
                position="brak"
            )
            db.add(owner)
            
            manager_user = User(
                email="manager@venue.com",
                password_hash=get_password_hash("Manager123!"),
                full_name="Jan Kowalski",
                role="manager",
                position="brak"
            )
            db.add(manager_user)
            
            worker = User(
                email="pracownik@venue.com",
                password_hash=get_password_hash("Worker123!"),
                full_name="Anna Nowak",
                role="worker",
                position="barman"
            )
            db.add(worker)
            db.commit()
            print("✅ Default users created")
        
        # Create sample events
        existing_events = db.query(Event).first()
        if not existing_events:
            owner = db.query(User).filter(User.role == "owner").first()
            
            # Event 1: Jazz Night
            event1 = Event(
                name="Jazz Night - Marcin Wasilewski Trio",
                description="Wieczór jazzowy z udziałem legendarnego tria Marcina Wasilewskiego",
                event_date=datetime(2026, 2, 14, 20, 0),
                end_date=datetime(2026, 2, 15, 1, 0),
                venue="BOWL",
                expected_attendees=150,
                ticket_price=89.0,
                status="upcoming",
                color="#1e3a5f",
                rider_stage1="Piano Steinway lub Yamaha C3, stołek z regulacją wysokości",
                rider_stage2="Kontrabas - DI Box, statyw na mikrofon",
                rider_notes="Wymagana cisza na sali podczas koncertu. Artyści wymagają osobnej garderoby.",
                created_by=owner.id if owner else None
            )
            db.add(event1)
            db.flush()
            
            # Lineup for Event 1
            lineup1 = [
                LineupEntry(event_id=event1.id, artist_name="DJ Warm-up Set", stage="BOWL", 
                           start_time=datetime(2026, 2, 14, 20, 0), end_time=datetime(2026, 2, 14, 21, 0),
                           description="Muzyka w tle", is_headliner=False, order_index=1),
                LineupEntry(event_id=event1.id, artist_name="Marcin Wasilewski Trio", stage="BOWL",
                           start_time=datetime(2026, 2, 14, 21, 0), end_time=datetime(2026, 2, 14, 23, 30),
                           description="Główny koncert wieczoru", is_headliner=True, order_index=2),
            ]
            for entry in lineup1:
                db.add(entry)
            
            # Costs for Event 1
            costs1 = [
                Cost(event_id=event1.id, category="artist_fee", amount=8500, description="Honorarium Marcin Wasilewski Trio", created_by=owner.id if owner else None),
                Cost(event_id=event1.id, category="lighting", amount=1200, description="Nagłośnienie i oświetlenie", created_by=owner.id if owner else None),
                Cost(event_id=event1.id, category="food_drinks", amount=450, description="Catering dla artystów", created_by=owner.id if owner else None),
                Cost(event_id=event1.id, category="marketing", amount=350, description="Promocja w social media", created_by=owner.id if owner else None),
            ]
            for cost in costs1:
                db.add(cost)
            
            # Event 2: Rock Covers
            event2 = Event(
                name="Rock Covers Party",
                description="Wieczór z coverami rockowych klasyków",
                event_date=datetime(2026, 2, 21, 21, 0),
                end_date=datetime(2026, 2, 22, 3, 0),
                venue="BOWL",
                expected_attendees=200,
                ticket_price=45.0,
                status="upcoming",
                color="#8b0000",
                rider_stage1="Perkusja pełna, 2x wzmacniacz gitarowy Marshall/Fender, wzmacniacz basowy Ampeg",
                rider_stage2="Keyboard + statyw, DI Box x2",
                created_by=owner.id if owner else None
            )
            db.add(event2)
            db.flush()
            
            # Lineup for Event 2
            lineup2 = [
                LineupEntry(event_id=event2.id, artist_name="Local Heroes", stage="BOWL",
                           start_time=datetime(2026, 2, 21, 21, 0), end_time=datetime(2026, 2, 21, 22, 30),
                           description="Support - lokalna kapela", is_headliner=False, order_index=1),
                LineupEntry(event_id=event2.id, artist_name="Rock Legends Tribute", stage="BOWL",
                           start_time=datetime(2026, 2, 21, 23, 0), end_time=datetime(2026, 2, 22, 1, 0),
                           description="Główny występ - tribute band", is_headliner=True, order_index=2),
                LineupEntry(event_id=event2.id, artist_name="DJ Afterparty", stage="BOWL",
                           start_time=datetime(2026, 2, 22, 1, 0), end_time=datetime(2026, 2, 22, 3, 0),
                           description="Afterparty do zamknięcia", is_headliner=False, order_index=3),
            ]
            for entry in lineup2:
                db.add(entry)
            
            costs2 = [
                Cost(event_id=event2.id, category="artist_fee", amount=4500, description="Honoraria zespołów", created_by=owner.id if owner else None),
                Cost(event_id=event2.id, category="equipment", amount=800, description="Wynajem sprzętu", created_by=owner.id if owner else None),
                Cost(event_id=event2.id, category="security", amount=1200, description="Ochrona", created_by=owner.id if owner else None),
            ]
            for cost in costs2:
                db.add(cost)
            
            # Event 3: Electronic Night
            event3 = Event(
                name="Elektroniczna Noc - DJ Set",
                description="Nocna impreza z najlepszymi DJ-ami elektronicznej sceny",
                event_date=datetime(2026, 2, 28, 22, 0),
                end_date=datetime(2026, 3, 1, 6, 0),
                venue="BOWL",
                expected_attendees=250,
                ticket_price=55.0,
                status="upcoming",
                color="#4a0080",
                rider_stage1="2x Pioneer CDJ-3000, DJM-900NXS2, monitor odsłuchowy",
                rider_stage2="Pioneer DDJ-1000 (backup), monitor odsłuchowy",
                rider_notes="Wymagany dymarka i laser show. Minimum 4kW systemu nagłośnieniowego.",
                created_by=owner.id if owner else None
            )
            db.add(event3)
            db.flush()
            
            lineup3 = [
                LineupEntry(event_id=event3.id, artist_name="DJ Warm-up", stage="BOWL",
                           start_time=datetime(2026, 2, 28, 22, 0), end_time=datetime(2026, 3, 1, 0, 0),
                           description="Opening set", is_headliner=False, order_index=1),
                LineupEntry(event_id=event3.id, artist_name="Headliner DJ", stage="BOWL",
                           start_time=datetime(2026, 3, 1, 0, 0), end_time=datetime(2026, 3, 1, 3, 0),
                           description="Main set - techno/house", is_headliner=True, order_index=2),
                LineupEntry(event_id=event3.id, artist_name="Resident DJ", stage="BOWL",
                           start_time=datetime(2026, 3, 1, 3, 0), end_time=datetime(2026, 3, 1, 6, 0),
                           description="Closing set", is_headliner=False, order_index=3),
            ]
            for entry in lineup3:
                db.add(entry)
            
            costs3 = [
                Cost(event_id=event3.id, category="artist_fee", amount=5500, description="DJ + przelot", created_by=owner.id if owner else None),
                Cost(event_id=event3.id, category="lighting", amount=1500, description="Oświetlenie LED + laser", created_by=owner.id if owner else None),
                Cost(event_id=event3.id, category="security", amount=1800, description="Ochrona 6 osób", created_by=owner.id if owner else None),
            ]
            for cost in costs3:
                db.add(cost)
            
            db.commit()
            print("✅ Sample events, line-ups and costs created")
            
    except Exception as e:
        print(f"⚠️ Startup error: {e}")
        db.rollback()
    finally:
        db.close()


# ==================== AUTH HELPERS ====================

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Brak autoryzacji")
    
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Nieprawidłowy token")
    
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user:
        raise HTTPException(status_code=401, detail="Użytkownik nie znaleziony")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Konto nieaktywne")
    
    return user


def require_role(roles: List[str]):
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Brak uprawnień")
        return current_user
    return role_checker


# ==================== AUTH ENDPOINTS ====================

@app.post("/api/auth/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Nieprawidłowe dane logowania")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Konto nieaktywne")
    
    token = create_access_token({"sub": str(user.id), "role": user.role})
    
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse.model_validate(user)
    )


@app.post("/api/auth/register", response_model=UserResponse)
def register(data: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email już istnieje")
    
    user = User(
        email=data.email,
        password_hash=get_password_hash(data.password),
        full_name=data.full_name,
        role="worker"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


# ==================== USERS ====================

@app.get("/api/users", response_model=List[UserResponse])
def list_users(current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.full_name).all()
    return [UserResponse.model_validate(u) for u in users]


@app.post("/api/users", response_model=UserResponse)
def create_user(data: UserCreate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email już istnieje")
    
    # Managers can only create workers
    if current_user.role == "manager" and data.role != UserRole.WORKER:
        raise HTTPException(status_code=403, detail="Manager może tworzyć tylko pracowników")
    
    user = User(
        email=data.email,
        password_hash=get_password_hash(data.password),
        full_name=data.full_name,
        role=data.role.value,
        position=data.position or "brak"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@app.put("/api/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, data: UserUpdate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    # Prevent privilege escalation
    if current_user.role == "manager" and user.role == "owner":
        raise HTTPException(status_code=403, detail="Nie możesz edytować właściciela")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "role" and value:
            setattr(user, field, value.value if hasattr(value, 'value') else value)
        else:
            setattr(user, field, value)
    
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, current_user: User = Depends(require_role(["owner"])), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Nie możesz usunąć siebie")
    
    db.delete(user)
    db.commit()
    return {"message": f"Użytkownik {user.full_name} został usunięty"}


@app.put("/api/users/{user_id}/position")
def update_user_position(user_id: int, data: PositionUpdate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    user.position = data.position
    db.commit()
    return {"message": "Stanowisko zaktualizowane"}


@app.put("/api/users/me/sound-notifications")
def update_sound_notifications(data: SoundNotificationUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.sound_notifications = data.enabled
    db.commit()
    return {"message": "Ustawienia zapisane", "sound_notifications": current_user.sound_notifications}


# ==================== STAFF POSITIONS ====================

@app.get("/api/staff/positions")
def get_positions(db: Session = Depends(get_db)):
    positions = db.query(StaffPosition).filter(StaffPosition.is_active == True).order_by(StaffPosition.name).all()
    # Return as dict {code: name} for frontend POSITION_LABELS
    positions_dict = {p.code: p.name for p in positions}
    return {"positions": positions_dict}


@app.get("/api/staff/positions/all")
def get_all_positions(current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    positions = db.query(StaffPosition).order_by(StaffPosition.name).all()
    result = []
    for p in positions:
        data = p.to_dict()
        data["users_count"] = db.query(User).filter(User.position == p.code).count()
        result.append(data)
    return result


@app.post("/api/staff/positions", response_model=StaffPositionResponse)
def create_position(data: StaffPositionCreate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    if db.query(StaffPosition).filter(StaffPosition.code == data.code).first():
        raise HTTPException(status_code=400, detail="Stanowisko o tym kodzie już istnieje")
    
    position = StaffPosition(code=data.code, name=data.name, description=data.description or "")
    db.add(position)
    db.commit()
    db.refresh(position)
    return StaffPositionResponse.model_validate(position)


@app.put("/api/staff/positions/{position_id}", response_model=StaffPositionResponse)
def update_position(position_id: int, data: StaffPositionUpdate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    position = db.query(StaffPosition).filter(StaffPosition.id == position_id).first()
    if not position:
        raise HTTPException(status_code=404, detail="Stanowisko nie znalezione")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(position, field, value)
    
    db.commit()
    db.refresh(position)
    return StaffPositionResponse.model_validate(position)


@app.delete("/api/staff/positions/{position_id}")
def delete_position(position_id: int, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    position = db.query(StaffPosition).filter(StaffPosition.id == position_id).first()
    if not position:
        raise HTTPException(status_code=404, detail="Stanowisko nie znalezione")
    
    if position.code == "brak":
        raise HTTPException(status_code=400, detail="Nie można usunąć domyślnego stanowiska")
    
    users_with_position = db.query(User).filter(User.position == position.code).count()
    if users_with_position > 0:
        position.is_active = False
        db.commit()
        return {"message": f"Stanowisko dezaktywowane ({users_with_position} użytkowników ma to stanowisko)"}
    
    db.delete(position)
    db.commit()
    return {"message": "Stanowisko usunięte"}


# ==================== EVENTS ====================

@app.post("/api/events", response_model=EventResponse)
def create_event(data: EventCreate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    event = Event(
        name=data.name,
        description=data.description,
        event_date=data.event_date,
        end_date=data.end_date,
        venue=data.venue,
        expected_attendees=data.expected_attendees,
        ticket_price=data.ticket_price,
        status=data.status,
        color=data.color,
        rider_stage1=data.rider_stage1,
        rider_stage2=data.rider_stage2,
        rider_notes=data.rider_notes,
        created_by=current_user.id
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    
    response = EventResponse.model_validate(event)
    response.has_rider_file = event.rider_file_data is not None
    response.lineup = []
    return response


@app.get("/api/events", response_model=List[EventResponse])
def list_events(status: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Event)
    if status:
        query = query.filter(Event.status == status)
    events = query.order_by(Event.event_date.desc()).all()
    
    result = []
    for e in events:
        resp = EventResponse.model_validate(e)
        resp.has_rider_file = e.rider_file_data is not None
        resp.lineup = [LineupEntryResponse.model_validate(l) for l in e.lineup]
        result.append(resp)
    return result


@app.get("/api/events/{event_id}", response_model=EventResponse)
def get_event(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    resp = EventResponse.model_validate(event)
    resp.has_rider_file = event.rider_file_data is not None
    resp.lineup = [LineupEntryResponse.model_validate(l) for l in event.lineup]
    return resp


@app.put("/api/events/{event_id}", response_model=EventResponse)
def update_event(event_id: int, data: EventUpdate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    
    db.commit()
    db.refresh(event)
    
    resp = EventResponse.model_validate(event)
    resp.has_rider_file = event.rider_file_data is not None
    resp.lineup = [LineupEntryResponse.model_validate(l) for l in event.lineup]
    return resp


@app.delete("/api/events/{event_id}")
def delete_event(event_id: int, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    db.delete(event)
    db.commit()
    return {"message": "Event usunięty"}


# ==================== EVENT RIDER FILE ====================

@app.post("/api/events/{event_id}/rider-file")
async def upload_rider_file(
    event_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    # Check file type
    allowed_types = ["application/pdf", "text/plain"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Dozwolone tylko pliki PDF i TXT")
    
    # Check file size (max 10MB)
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Plik zbyt duży (max 10MB)")
    
    event.rider_file_data = content
    event.rider_file_name = file.filename
    event.rider_file_type = file.content_type
    db.commit()
    
    return {"message": "Rider uploaded", "filename": file.filename}


@app.get("/api/events/{event_id}/rider-file")
def download_rider_file(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    if not event.rider_file_data:
        raise HTTPException(status_code=404, detail="Brak pliku ridera")
    
    return Response(
        content=event.rider_file_data,
        media_type=event.rider_file_type or "application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={event.rider_file_name or 'rider'}"}
    )


@app.delete("/api/events/{event_id}/rider-file")
def delete_rider_file(event_id: int, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    event.rider_file_data = None
    event.rider_file_name = None
    event.rider_file_type = None
    db.commit()
    
    return {"message": "Rider file deleted"}


# ==================== LINE-UP ====================

@app.get("/api/events/{event_id}/lineup", response_model=List[LineupEntryResponse])
def get_lineup(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    lineup = db.query(LineupEntry).filter(LineupEntry.event_id == event_id).order_by(LineupEntry.start_time).all()
    return [LineupEntryResponse.model_validate(l) for l in lineup]


@app.post("/api/events/{event_id}/lineup", response_model=LineupEntryResponse)
def add_lineup_entry(event_id: int, data: LineupEntryCreate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    entry = LineupEntry(
        event_id=event_id,
        artist_name=data.artist_name,
        stage=data.stage,
        start_time=data.start_time,
        end_time=data.end_time,
        description=data.description,
        is_headliner=data.is_headliner,
        order_index=data.order_index
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return LineupEntryResponse.model_validate(entry)


@app.put("/api/events/{event_id}/lineup/{entry_id}", response_model=LineupEntryResponse)
def update_lineup_entry(event_id: int, entry_id: int, data: LineupEntryUpdate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    entry = db.query(LineupEntry).filter(LineupEntry.id == entry_id, LineupEntry.event_id == event_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Wpis nie znaleziony")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    
    db.commit()
    db.refresh(entry)
    return LineupEntryResponse.model_validate(entry)


@app.delete("/api/events/{event_id}/lineup/{entry_id}")
def delete_lineup_entry(event_id: int, entry_id: int, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    entry = db.query(LineupEntry).filter(LineupEntry.id == entry_id, LineupEntry.event_id == event_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Wpis nie znaleziony")
    
    db.delete(entry)
    db.commit()
    return {"message": "Wpis usunięty z line-upu"}


# ==================== CALENDAR ====================

@app.get("/api/calendar/{year}/{month}")
def get_calendar_events(year: int, month: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    start_date = datetime(year, month, 1)
    if month == 12:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, month + 1, 1)
    
    events = db.query(Event).filter(
        Event.event_date >= start_date,
        Event.event_date < end_date
    ).order_by(Event.event_date).all()
    
    return [{
        "id": e.id,
        "name": e.name,
        "event_date": e.event_date.isoformat(),
        "end_date": e.end_date.isoformat() if e.end_date else None,
        "venue": e.venue,
        "status": e.status,
        "color": e.color or "#3d6a99",
        "expected_attendees": e.expected_attendees
    } for e in events]


# ==================== COSTS ====================

@app.post("/api/costs", response_model=CostResponse)
def create_cost(data: CostCreate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == data.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    cost = Cost(
        event_id=data.event_id,
        category=data.category.value,
        amount=data.amount,
        description=data.description,
        cost_date=data.cost_date or datetime.utcnow(),
        receipt_id=data.receipt_id,
        created_by=current_user.id
    )
    db.add(cost)
    db.commit()
    db.refresh(cost)
    return CostResponse.model_validate(cost)


@app.get("/api/costs", response_model=List[CostResponse])
def list_costs(event_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Cost)
    if event_id:
        query = query.filter(Cost.event_id == event_id)
    costs = query.order_by(Cost.created_at.desc()).all()
    return [CostResponse.model_validate(c) for c in costs]


@app.put("/api/costs/{cost_id}", response_model=CostResponse)
def update_cost(cost_id: int, data: CostUpdate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Koszt nie znaleziony")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "category" and value:
            setattr(cost, field, value.value if hasattr(value, 'value') else value)
        else:
            setattr(cost, field, value)
    
    db.commit()
    db.refresh(cost)
    return CostResponse.model_validate(cost)


@app.delete("/api/costs/{cost_id}")
def delete_cost(cost_id: int, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Koszt nie znaleziony")
    
    db.delete(cost)
    db.commit()
    return {"message": "Koszt usunięty"}


@app.get("/api/costs/categories")
def get_cost_categories():
    return {
        "bar_alcohol": "Alkohol (bar)",
        "bar_beverages": "Napoje (bar)",
        "bar_food": "Jedzenie (bar)",
        "bar_supplies": "Zaopatrzenie (bar)",
        "artist_fee": "Honorarium artysty",
        "sound_engineer": "Realizator dźwięku",
        "lighting": "Oświetlenie",
        "staff_wages": "Wynagrodzenia",
        "security": "Ochrona",
        "cleaning": "Sprzątanie",
        "utilities": "Media",
        "rent": "Wynajem",
        "equipment": "Sprzęt",
        "marketing": "Marketing",
        "food_drinks": "Jedzenie i napoje",
        "other": "Inne"
    }


@app.get("/api/stats/categories")
def get_stats_categories():
    """Returns all categories for frontend dropdowns"""
    return {
        "cost_categories": {
            "bar_alcohol": "Alkohol (bar)",
            "bar_beverages": "Napoje (bar)",
            "bar_food": "Jedzenie (bar)",
            "bar_supplies": "Zaopatrzenie (bar)",
            "artist_fee": "Honorarium artysty",
            "sound_engineer": "Realizator dźwięku",
            "lighting": "Oświetlenie",
            "staff_wages": "Wynagrodzenia",
            "security": "Ochrona",
            "cleaning": "Sprzątanie",
            "utilities": "Media",
            "rent": "Wynajem",
            "equipment": "Sprzęt",
            "marketing": "Marketing",
            "food_drinks": "Jedzenie i napoje",
            "other": "Inne"
        },
        "revenue_sources": {
            "tickets": "Bilety",
            "bar": "Bar",
            "vip": "VIP / Rezerwacje",
            "merch": "Merchandise",
            "sponsorship": "Sponsoring",
            "rental": "Wynajem sali",
            "other": "Inne"
        }
    }


@app.get("/api/costs/event/{event_id}", response_model=List[CostResponse])
def list_costs_by_event(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all costs for a specific event"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    costs = db.query(Cost).filter(Cost.event_id == event_id).order_by(Cost.created_at.desc()).all()
    return [CostResponse.model_validate(c) for c in costs]


# ==================== REVENUE ====================

@app.post("/api/revenue", response_model=RevenueResponse)
def create_revenue(data: RevenueCreate, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == data.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
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


@app.get("/api/revenue", response_model=List[RevenueResponse])
def list_revenue(event_id: Optional[int] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Revenue)
    if event_id:
        query = query.filter(Revenue.event_id == event_id)
    revenues = query.order_by(Revenue.created_at.desc()).all()
    return [RevenueResponse.model_validate(r) for r in revenues]


@app.delete("/api/revenue/{revenue_id}")
def delete_revenue(revenue_id: int, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    revenue = db.query(Revenue).filter(Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Przychód nie znaleziony")
    
    db.delete(revenue)
    db.commit()
    return {"message": "Przychód usunięty"}


@app.get("/api/revenue/event/{event_id}", response_model=List[RevenueResponse])
def list_revenue_by_event(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get all revenues for a specific event"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    revenues = db.query(Revenue).filter(Revenue.event_id == event_id).order_by(Revenue.created_at.desc()).all()
    return [RevenueResponse.model_validate(r) for r in revenues]


# ==================== RECEIPTS (OCR) ====================

def parse_receipt_ocr(ocr_text: str) -> dict:
    """Parse OCR text from receipt - improved Polish receipt parsing"""
    result = {
        "store_name": None,
        "date": None,
        "total": None,
        "items": []
    }
    
    if not ocr_text:
        return result
    
    lines = ocr_text.strip().split('\n')
    
    # Store name (usually first non-empty line)
    for line in lines[:5]:
        line = line.strip()
        if len(line) > 3 and not any(c.isdigit() for c in line[:3]):
            result["store_name"] = line
            break
    
    # Date patterns
    date_patterns = [
        r'(\d{4}[-/.]\d{2}[-/.]\d{2})',
        r'(\d{2}[-/.]\d{2}[-/.]\d{4})',
        r'(\d{2}[-/.]\d{2}[-/.]\d{2})',
    ]
    
    for pattern in date_patterns:
        match = re.search(pattern, ocr_text)
        if match:
            result["date"] = match.group(1)
            break
    
    # Total amount - comprehensive Polish patterns
    total_patterns = [
        r'SUMA\s*:?\s*(\d+[.,]\d{2})',
        r'SUMA\s+PLN\s*:?\s*(\d+[.,]\d{2})',
        r'SUMA\s+ZŁ\s*:?\s*(\d+[.,]\d{2})',
        r'KWOTA\s+DO\s+ZAPŁATY\s*:?\s*(\d+[.,]\d{2})',
        r'DO\s+ZAPŁATY\s*:?\s*(\d+[.,]\d{2})',
        r'DO\s+ZAPŁATY\s+PLN\s*:?\s*(\d+[.,]\d{2})',
        r'RAZEM\s*:?\s*(\d+[.,]\d{2})',
        r'RAZEM\s+PLN\s*:?\s*(\d+[.,]\d{2})',
        r'RAZEM\s+ZŁ\s*:?\s*(\d+[.,]\d{2})',
        r'WARTOŚĆ\s+BRUTTO\s*:?\s*(\d+[.,]\d{2})',
        r'OGÓŁEM\s*:?\s*(\d+[.,]\d{2})',
        r'ŁĄCZNIE\s*:?\s*(\d+[.,]\d{2})',
        r'NALEŻNOŚĆ\s*:?\s*(\d+[.,]\d{2})',
        r'GOTÓWKA\s*:?\s*(\d+[.,]\d{2})',
        r'KARTA\s*:?\s*(\d+[.,]\d{2})',
        r'PŁATNOŚĆ\s*:?\s*(\d+[.,]\d{2})',
        r'TOTAL\s*:?\s*(\d+[.,]\d{2})',
        r'SPRZEDAŻ\s+OPODATKOWANA\s*[A-Z]?\s*(\d+[.,]\d{2})',
        r'PTU\s*[A-Z]?\s*\d+%?\s*(\d+[.,]\d{2})\s*$',
    ]
    
    text_upper = ocr_text.upper()
    for pattern in total_patterns:
        match = re.search(pattern, text_upper, re.IGNORECASE | re.MULTILINE)
        if match:
            total_str = match.group(1).replace(',', '.')
            try:
                result["total"] = float(total_str)
                break
            except ValueError:
                continue
    
    # If no total found, find largest reasonable amount
    if result["total"] is None:
        amounts = re.findall(r'(\d+[.,]\d{2})', ocr_text)
        valid_amounts = []
        for a in amounts:
            try:
                val = float(a.replace(',', '.'))
                if 1 <= val <= 10000:
                    valid_amounts.append(val)
            except ValueError:
                continue
        if valid_amounts:
            result["total"] = max(valid_amounts)
    
    # Parse items
    item_pattern = r'([A-Za-zżźćńółęąśŻŹĆĄŚĘŁÓŃ\s]+)\s+(\d+[.,]\d{2})'
    for match in re.finditer(item_pattern, ocr_text):
        name = match.group(1).strip()
        if len(name) > 2:
            try:
                price = float(match.group(2).replace(',', '.'))
                result["items"].append({"name": name, "price": price})
            except ValueError:
                continue
    
    return result


@app.post("/api/receipts/upload")
async def upload_receipt(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Tylko pliki graficzne")
    
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Plik zbyt duży (max 10MB)")
    
    image_base64 = base64.b64encode(content).decode()
    
    # Mock OCR (in real app, use Tesseract or cloud OCR)
    ocr_text = "BIEDRONKA\nul. Przykładowa 1\n2026-02-07\nPiwo 6.99\nChipsy 4.50\nSUMA PLN: 11.49"
    parsed = parse_receipt_ocr(ocr_text)
    
    receipt = Receipt(
        store_name=parsed.get("store_name"),
        receipt_date=datetime.utcnow(),
        total_amount=parsed.get("total"),
        ocr_text=ocr_text,
        parsed_items=json.dumps(parsed.get("items", [])),
        image_data=image_base64,
        image_mime_type=file.content_type,
        status="pending",
        uploaded_by=current_user.id
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    
    return {
        "id": receipt.id,
        "store_name": receipt.store_name,
        "total_amount": receipt.total_amount,
        "status": receipt.status,
        "parsed_data": parsed
    }


@app.get("/api/receipts", response_model=List[ReceiptResponse])
def list_receipts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    receipts = db.query(Receipt).order_by(Receipt.created_at.desc()).all()
    result = []
    for r in receipts:
        resp = ReceiptResponse(
            id=r.id,
            store_name=r.store_name,
            receipt_date=r.receipt_date,
            total_amount=r.total_amount,
            ocr_text=r.ocr_text,
            parsed_items=r.parsed_items,
            status=r.status,
            uploaded_by=r.uploaded_by,
            uploader_name=r.uploader.full_name if r.uploader else None,
            processed_by=r.processed_by,
            processor_name=r.processor.full_name if r.processor else None,
            created_at=r.created_at,
            processed_at=r.processed_at,
            has_image=r.image_data is not None
        )
        result.append(resp)
    return result


@app.get("/api/receipts/{receipt_id}/image")
def get_receipt_image(receipt_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt or not receipt.image_data:
        raise HTTPException(status_code=404, detail="Obraz nie znaleziony")
    
    image_bytes = base64.b64decode(receipt.image_data)
    return Response(content=image_bytes, media_type=receipt.image_mime_type or "image/jpeg")


@app.post("/api/receipts/{receipt_id}/to-cost")
def receipt_to_cost(receipt_id: int, data: ReceiptToCost, current_user: User = Depends(require_role(["owner", "manager"])), db: Session = Depends(get_db)):
    receipt = db.query(Receipt).filter(Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")
    
    event = db.query(Event).filter(Event.id == data.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    cost = Cost(
        event_id=data.event_id,
        category=data.category.value,
        amount=data.amount or receipt.total_amount or 0,
        description=data.description or f"Z paragonu: {receipt.store_name}",
        receipt_id=receipt.id,
        created_by=current_user.id
    )
    db.add(cost)
    
    receipt.status = "processed"
    receipt.processed_by = current_user.id
    receipt.processed_at = datetime.utcnow()
    
    db.commit()
    return {"message": "Koszt utworzony z paragonu", "cost_id": cost.id}


# ==================== DASHBOARD ====================

@app.get("/api/dashboard")
def get_dashboard(year: int = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not year:
        year = datetime.now().year
    
    start_date = datetime(year, 1, 1)
    end_date = datetime(year + 1, 1, 1)
    
    events = db.query(Event).filter(Event.event_date >= start_date, Event.event_date < end_date).all()
    
    total_revenue = db.query(func.sum(Revenue.amount)).join(Event).filter(
        Event.event_date >= start_date, Event.event_date < end_date
    ).scalar() or 0
    
    total_costs = db.query(func.sum(Cost.amount)).join(Event).filter(
        Event.event_date >= start_date, Event.event_date < end_date
    ).scalar() or 0
    
    pending_receipts = db.query(Receipt).filter(Receipt.status == "pending").count()
    
    upcoming_events = db.query(Event).filter(
        Event.event_date >= datetime.utcnow(),
        Event.status == "upcoming"
    ).count()
    
    return {
        "year": year,
        "total_events": len(events),
        "upcoming_events": upcoming_events,
        "total_revenue": float(total_revenue),
        "total_costs": float(total_costs),
        "profit": float(total_revenue - total_costs),
        "pending_receipts": pending_receipts
    }


@app.get("/api/reports/event/{event_id}")
def get_event_report(event_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event nie znaleziony")
    
    costs = db.query(Cost).filter(Cost.event_id == event_id).all()
    revenues = db.query(Revenue).filter(Revenue.event_id == event_id).all()
    
    cost_breakdown = {}
    for c in costs:
        cat = c.category
        cost_breakdown[cat] = cost_breakdown.get(cat, 0) + c.amount
    
    revenue_breakdown = {}
    for r in revenues:
        src = r.source
        revenue_breakdown[src] = revenue_breakdown.get(src, 0) + r.amount
    
    total_costs = sum(c.amount for c in costs)
    total_revenue = sum(r.amount for r in revenues)
    
    return {
        "event_id": event.id,
        "event_name": event.name,
        "event_date": event.event_date.isoformat(),
        "total_revenue": total_revenue,
        "total_costs": total_costs,
        "profit": total_revenue - total_costs,
        "cost_breakdown": cost_breakdown,
        "revenue_breakdown": revenue_breakdown
    }


# ==================== CHAT ====================

@app.get("/api/chat/messages")
def get_chat_messages(limit: int = 50, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    messages = db.query(ChatMessage).order_by(ChatMessage.created_at.desc()).limit(limit).all()
    messages.reverse()
    
    return [{
        "id": m.id,
        "sender_id": m.sender_id,
        "sender_name": m.sender.full_name if m.sender else "Unknown",
        "content": m.content,
        "message_type": m.message_type,
        "is_read": m.is_read,
        "created_at": m.created_at.isoformat()
    } for m in messages]


@app.post("/api/chat/messages")
async def send_chat_message(data: ChatMessageCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    message = ChatMessage(
        sender_id=current_user.id,
        content=data.content,
        message_type="text"
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    
    msg_data = {
        "type": "chat_message",
        "id": message.id,
        "sender_id": current_user.id,
        "sender_name": current_user.full_name,
        "content": message.content,
        "created_at": message.created_at.isoformat()
    }
    await manager.broadcast(msg_data)
    
    return msg_data


@app.get("/api/chat/users")
def get_chat_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    users = db.query(User).filter(User.is_active == True).all()
    online_ids = manager.get_online_users()
    
    return [{
        "id": u.id,
        "full_name": u.full_name,
        "role": u.role,
        "is_online": u.id in online_ids
    } for u in users]


@app.get("/api/chat/history")
def get_chat_history(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    messages = db.query(ChatMessage).order_by(ChatMessage.created_at.desc()).limit(100).all()
    messages.reverse()
    
    # Get online users
    online_users = []
    for user_id in manager.active_connections.keys():
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            online_users.append({
                "id": user.id,
                "full_name": user.full_name,
                "role": user.role
            })
    
    return {
        "messages": [{
            "id": m.id,
            "sender_id": m.sender_id,
            "sender_name": m.sender.full_name if m.sender else "Unknown",
            "sender_role": m.sender.role if m.sender else "worker",
            "content": m.content,
            "message_type": m.message_type,
            "created_at": m.created_at.isoformat()
        } for m in messages],
        "users_online": online_users,
        "total_unread": 0
    }


# ==================== PRIVATE MESSAGES ====================

@app.get("/api/messages/conversations")
def get_conversations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user.id
    
    # Get all users who have exchanged messages with current user
    sent_to = db.query(PrivateMessage.recipient_id).filter(PrivateMessage.sender_id == user_id).distinct()
    received_from = db.query(PrivateMessage.sender_id).filter(PrivateMessage.recipient_id == user_id).distinct()
    
    partner_ids = set([r[0] for r in sent_to.all()] + [r[0] for r in received_from.all()])
    
    conversations = []
    for partner_id in partner_ids:
        partner = db.query(User).filter(User.id == partner_id).first()
        if not partner:
            continue
        
        last_msg = db.query(PrivateMessage).filter(
            or_(
                and_(PrivateMessage.sender_id == user_id, PrivateMessage.recipient_id == partner_id),
                and_(PrivateMessage.sender_id == partner_id, PrivateMessage.recipient_id == user_id)
            )
        ).order_by(PrivateMessage.created_at.desc()).first()
        
        unread = db.query(PrivateMessage).filter(
            PrivateMessage.sender_id == partner_id,
            PrivateMessage.recipient_id == user_id,
            PrivateMessage.is_read == False
        ).count()
        
        conversations.append({
            "user_id": partner.id,
            "user_name": partner.full_name,
            "user_role": partner.role,
            "user_position": partner.position,
            "last_message": last_msg.content[:50] if last_msg else "",
            "last_message_time": last_msg.created_at.isoformat() if last_msg else None,
            "unread_count": unread,
            "is_online": manager.is_online(partner.id)
        })
    
    total_unread = sum(c["unread_count"] for c in conversations)
    sorted_convs = sorted(conversations, key=lambda x: x["last_message_time"] or "", reverse=True)
    
    return {
        "conversations": sorted_convs,
        "total_unread": total_unread
    }


@app.get("/api/messages/{user_id}")
def get_messages_with_user(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    messages = db.query(PrivateMessage).filter(
        or_(
            and_(PrivateMessage.sender_id == current_user.id, PrivateMessage.recipient_id == user_id),
            and_(PrivateMessage.sender_id == user_id, PrivateMessage.recipient_id == current_user.id)
        )
    ).order_by(PrivateMessage.created_at).all()
    
    # Mark as read
    db.query(PrivateMessage).filter(
        PrivateMessage.sender_id == user_id,
        PrivateMessage.recipient_id == current_user.id,
        PrivateMessage.is_read == False
    ).update({"is_read": True})
    db.commit()
    
    return [{
        "id": m.id,
        "sender_id": m.sender_id,
        "recipient_id": m.recipient_id,
        "content": m.content,
        "is_read": m.is_read,
        "created_at": m.created_at.isoformat(),
        "is_mine": m.sender_id == current_user.id
    } for m in messages]


@app.post("/api/messages/{user_id}")
async def send_private_message(user_id: int, data: PrivateMessageCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recipient = db.query(User).filter(User.id == user_id).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    
    message = PrivateMessage(
        sender_id=current_user.id,
        recipient_id=user_id,
        content=data.content
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    
    msg_data = {
        "type": "private_message",
        "id": message.id,
        "sender_id": current_user.id,
        "sender_name": current_user.full_name,
        "recipient_id": user_id,
        "content": message.content,
        "created_at": message.created_at.isoformat()
    }
    
    await manager.send_personal_message(msg_data, user_id)
    await manager.send_personal_message(msg_data, current_user.id)
    
    return msg_data


@app.get("/api/messages/unread/count")
def get_unread_count(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = db.query(PrivateMessage).filter(
        PrivateMessage.recipient_id == current_user.id,
        PrivateMessage.is_read == False
    ).count()
    return {"unread_count": count}


# ==================== WEBSOCKET ====================

@app.websocket("/ws/chat/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    payload = verify_token(token)
    if not payload:
        await websocket.close(code=4001)
        return
    
    user_id = int(payload["sub"])
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        await websocket.close(code=4001)
        return
    
    await manager.connect(websocket, user_id)
    
    # Notify others
    await manager.broadcast({
        "type": "user_online",
        "user_id": user_id,
        "user_name": user.full_name
    })
    
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")
            
            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            
            elif msg_type in ("message", "chat_message"):
                content = data.get("content", "").strip()
                if content:
                    message = ChatMessage(
                        sender_id=user_id,
                        content=content,
                        message_type="text"
                    )
                    db.add(message)
                    db.commit()
                    db.refresh(message)
                    
                    await manager.broadcast({
                        "type": "chat_message",
                        "id": message.id,
                        "sender_id": user_id,
                        "sender_name": user.full_name,
                        "sender_role": user.role,
                        "content": message.content,
                        "message_type": "text",
                        "created_at": message.created_at.isoformat()
                    })
            
            elif msg_type == "typing":
                await manager.broadcast({
                    "type": "user_typing",
                    "user_id": user_id,
                    "user_name": user.full_name
                })
                
    except WebSocketDisconnect:
        manager.disconnect(user_id)
        await manager.broadcast({
            "type": "user_offline",
            "user_id": user_id,
            "user_name": user.full_name
        })


# ==================== FRONTEND SERVING ====================

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if not os.path.exists(FRONTEND_DIR):
    FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")

print(f"✅ Frontend path: {FRONTEND_DIR}")


@app.get("/app/{path:path}")
async def serve_frontend(path: str):
    if not path or path == "":
        file_path = os.path.join(FRONTEND_DIR, "index.html")
    else:
        file_path = os.path.join(FRONTEND_DIR, path)
    
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/app")
async def redirect_to_app():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/app/")


@app.get("/")
async def redirect_root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/app/")
