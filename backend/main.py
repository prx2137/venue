"""
Music Venue Management System - FastAPI Backend
With Receipt OCR, Live Chat, User Management, Calendar, Private Messages
Version 4.0
"""

import os
import re
import json
import httpx
import base64
from datetime import datetime, timedelta
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func, extract

import models
import schemas
from database import engine, get_db
from security import (
    verify_password, 
    get_password_hash, 
    create_access_token, 
    decode_token,
    SECRET_KEY
)

# Create tables
models.Base.metadata.create_all(bind=engine)

# OCR.space API key
OCR_API_KEY = os.environ.get("OCR_API_KEY", "K82925827188957")

# Job positions
JOB_POSITIONS = [
    "Barman",
    "Barback", 
    "Świetlik",
    "Ochrona",
    "Akustyk",
    "Promotor",
    "Menedżer",
    "Szatnia",
    "Bramka"
]

# Store categories
STORE_CATEGORIES = {
    "biedronka": "Sklep spożywczy",
    "lidl": "Sklep spożywczy",
    "żabka": "Sklep spożywczy",
    "zabka": "Sklep spożywczy",
    "makro": "Hurtownia",
    "selgros": "Hurtownia",
    "carrefour": "Sklep spożywczy",
    "auchan": "Sklep spożywczy",
    "kaufland": "Sklep spożywczy",
    "lewiatan": "Sklep spożywczy",
    "dino": "Sklep spożywczy",
    "netto": "Sklep spożywczy",
    "stokrotka": "Sklep spożywczy",
    "orlen": "Stacja paliw",
    "bp": "Stacja paliw",
    "shell": "Stacja paliw",
    "circle k": "Stacja paliw",
    "rossmann": "Drogeria",
    "hebe": "Drogeria",
    "pepco": "Sklep przemysłowy",
    "action": "Sklep przemysłowy",
    "tesco": "Sklep spożywczy",
    "topaz": "Sklep spożywczy",
    "chata polska": "Sklep spożywczy",
    "polo market": "Sklep spożywczy",
    "intermarche": "Sklep spożywczy",
    "eurocash": "Hurtownia",
    "specjał": "Hurtownia alkoholi",
    "ambra": "Hurtownia alkoholi",
    "janton": "Hurtownia alkoholi"
}

def create_sample_data(db: Session):
    """Create sample data for demonstration"""
    # Check if sample data already exists
    existing_events = db.query(models.Event).first()
    if existing_events:
        return
    
    # Get admin user
    admin = db.query(models.User).filter(models.User.email == "admin@venue.com").first()
    if not admin:
        return
    
    # Sample events
    events_data = [
        {
            "name": "Noc Reggae z Habakuk",
            "date": datetime.now() - timedelta(days=14),
            "description": "Koncert zespołu Habakuk - legenda polskiego reggae",
            "ticket_price": 45.0,
            "expected_attendees": 350,
            "genre": "Reggae",
            "status": "completed",
            "actual_attendees": 328,
            "notes": "Świetna atmosfera, bar osiągnął rekord sprzedaży"
        },
        {
            "name": "Techno Therapy",
            "date": datetime.now() - timedelta(days=7),
            "description": "Noc z muzyką techno - DJ Krenzke, VTSS, Olivia",
            "ticket_price": 55.0,
            "expected_attendees": 500,
            "genre": "Techno",
            "status": "completed",
            "actual_attendees": 487,
            "notes": "Pełna sala, dodatkowa ochrona potrzebna"
        },
        {
            "name": "Jazz Evening - Marcin Wasilewski Trio",
            "date": datetime.now() + timedelta(days=10),
            "description": "Ekskluzywny wieczór jazzowy z najlepszym polskim pianistą",
            "ticket_price": 80.0,
            "expected_attendees": 200,
            "genre": "Jazz",
            "status": "upcoming",
            "notes": "Rezerwacje VIP na 30 miejsc"
        }
    ]
    
    for event_data in events_data:
        event = models.Event(**event_data, created_by=admin.id)
        db.add(event)
    
    db.commit()
    
    # Get created events
    events = db.query(models.Event).all()
    
    # Sample revenues (for completed events)
    revenues_data = [
        # Event 1 - Reggae
        {"event_id": events[0].id, "description": "Sprzedaż biletów", "amount": 14760.0, "category": "tickets"},
        {"event_id": events[0].id, "description": "Bar - piwo i drinki", "amount": 8450.0, "category": "bar"},
        {"event_id": events[0].id, "description": "Szatnia", "amount": 656.0, "category": "other"},
        # Event 2 - Techno
        {"event_id": events[1].id, "description": "Sprzedaż biletów", "amount": 26785.0, "category": "tickets"},
        {"event_id": events[1].id, "description": "Bar - napoje i alkohole", "amount": 15680.0, "category": "bar"},
        {"event_id": events[1].id, "description": "Szatnia", "amount": 974.0, "category": "other"},
        {"event_id": events[1].id, "description": "Sprzedaż merch", "amount": 1250.0, "category": "other"},
    ]
    
    for rev_data in revenues_data:
        revenue = models.Revenue(**rev_data, created_by=admin.id)
        db.add(revenue)
    
    # Sample costs
    costs_data = [
        # Event 1 - Reggae
        {"event_id": events[0].id, "description": "Honorarium zespołu Habakuk", "amount": 8000.0, "category": "artist_fee"},
        {"event_id": events[0].id, "description": "Ochrona - 4 osoby x 8h", "amount": 1600.0, "category": "staff"},
        {"event_id": events[0].id, "description": "Barmani - 3 osoby x 8h", "amount": 960.0, "category": "staff"},
        {"event_id": events[0].id, "description": "Zakup alkoholi - Makro", "amount": 3200.0, "category": "bar_stock"},
        {"event_id": events[0].id, "description": "Nagłośnienie dodatkowe", "amount": 800.0, "category": "equipment"},
        # Event 2 - Techno  
        {"event_id": events[1].id, "description": "Honoraria DJ-ów (3 osoby)", "amount": 6500.0, "category": "artist_fee"},
        {"event_id": events[1].id, "description": "Ochrona - 6 osób x 10h", "amount": 3000.0, "category": "staff"},
        {"event_id": events[1].id, "description": "Barmani - 4 osoby x 10h", "amount": 1600.0, "category": "staff"},
        {"event_id": events[1].id, "description": "Zakup alkoholi - hurtownia Specjał", "amount": 5500.0, "category": "bar_stock"},
        {"event_id": events[1].id, "description": "Oświetlenie laserowe", "amount": 1200.0, "category": "equipment"},
        {"event_id": events[1].id, "description": "Promocja FB/Instagram", "amount": 800.0, "category": "marketing"},
        # Event 3 - Jazz (planned)
        {"event_id": events[2].id, "description": "Honorarium Marcin Wasilewski Trio", "amount": 12000.0, "category": "artist_fee"},
        {"event_id": events[2].id, "description": "Catering VIP", "amount": 1500.0, "category": "other"},
    ]
    
    for cost_data in costs_data:
        cost = models.Cost(**cost_data, created_by=admin.id)
        db.add(cost)
    
    # Sample staff assignments
    staff_data = [
        # Event 1
        {"event_id": events[0].id, "position": "Barman", "name": "Kasia Nowak", "hours": 8, "hourly_rate": 40.0},
        {"event_id": events[0].id, "position": "Barman", "name": "Tomek Wiśniewski", "hours": 8, "hourly_rate": 40.0},
        {"event_id": events[0].id, "position": "Barback", "name": "Piotr Zając", "hours": 8, "hourly_rate": 30.0},
        {"event_id": events[0].id, "position": "Ochrona", "name": "Marek Kowalski", "hours": 8, "hourly_rate": 50.0},
        {"event_id": events[0].id, "position": "Ochrona", "name": "Adam Mazur", "hours": 8, "hourly_rate": 50.0},
        {"event_id": events[0].id, "position": "Szatnia", "name": "Ola Lewandowska", "hours": 8, "hourly_rate": 30.0},
        {"event_id": events[0].id, "position": "Akustyk", "name": "Bartek Dąbrowski", "hours": 8, "hourly_rate": 60.0},
        # Event 2
        {"event_id": events[1].id, "position": "Barman", "name": "Kasia Nowak", "hours": 10, "hourly_rate": 40.0},
        {"event_id": events[1].id, "position": "Barman", "name": "Tomek Wiśniewski", "hours": 10, "hourly_rate": 40.0},
        {"event_id": events[1].id, "position": "Barman", "name": "Ania Wójcik", "hours": 10, "hourly_rate": 40.0},
        {"event_id": events[1].id, "position": "Barback", "name": "Piotr Zając", "hours": 10, "hourly_rate": 30.0},
        {"event_id": events[1].id, "position": "Barback", "name": "Kamil Szymański", "hours": 10, "hourly_rate": 30.0},
        {"event_id": events[1].id, "position": "Ochrona", "name": "Marek Kowalski", "hours": 10, "hourly_rate": 50.0},
        {"event_id": events[1].id, "position": "Ochrona", "name": "Adam Mazur", "hours": 10, "hourly_rate": 50.0},
        {"event_id": events[1].id, "position": "Ochrona", "name": "Rafał Krawczyk", "hours": 10, "hourly_rate": 50.0},
        {"event_id": events[1].id, "position": "Świetlik", "name": "Dawid Piotrowski", "hours": 10, "hourly_rate": 45.0},
        {"event_id": events[1].id, "position": "Bramka", "name": "Grzegorz Jankowski", "hours": 10, "hourly_rate": 35.0},
    ]
    
    for staff in staff_data:
        assignment = models.StaffAssignment(**staff)
        db.add(assignment)
    
    db.commit()
    print("✅ Sample data created successfully")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create default users and sample data
    db = next(get_db())
    try:
        # Create default users if not exist
        default_users = [
            {"email": "admin@venue.com", "password": "Admin123!", "full_name": "Administrator", "role": "owner"},
            {"email": "manager@venue.com", "password": "Manager123!", "full_name": "Manager Klubu", "role": "manager"},
            {"email": "worker@venue.com", "password": "Worker123!", "full_name": "Pracownik", "role": "worker"},
        ]
        
        for user_data in default_users:
            existing = db.query(models.User).filter(models.User.email == user_data["email"]).first()
            if not existing:
                user = models.User(
                    email=user_data["email"],
                    password_hash=get_password_hash(user_data["password"]),
                    full_name=user_data["full_name"],
                    role=user_data["role"],
                    is_active=True
                )
                db.add(user)
        db.commit()
        
        # Create sample data
        create_sample_data(db)
        
    finally:
        db.close()
    
    yield
    # Shutdown
    pass


app = FastAPI(
    title="Music Venue Management API",
    description="API for managing music venue events, finances, staff and chat",
    version="4.0.0",
    lifespan=lifespan
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


# ============== DEPENDENCIES ==============

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> models.User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    payload = decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user = db.query(models.User).filter(models.User.id == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    
    return user


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[models.User]:
    if not credentials:
        return None
    
    payload = decode_token(credentials.credentials)
    if not payload:
        return None
    
    user = db.query(models.User).filter(models.User.id == payload.get("sub")).first()
    return user if user and user.is_active else None


def require_manager_or_owner(current_user: models.User = Depends(get_current_user)):
    if current_user.role not in ["manager", "owner"]:
        raise HTTPException(status_code=403, detail="Manager or owner access required")
    return current_user


def require_owner(current_user: models.User = Depends(get_current_user)):
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return current_user


# ============== AUTH ENDPOINTS ==============

@app.post("/api/auth/login", response_model=schemas.TokenResponse)
async def login(credentials: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == credentials.email).first()
    
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account is disabled")
    
    token = create_access_token({"sub": str(user.id), "role": user.role})
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": user.role
        }
    }


@app.get("/api/auth/me", response_model=schemas.UserResponse)
async def get_me(current_user: models.User = Depends(get_current_user)):
    return current_user


# ============== JOB POSITIONS ==============

@app.get("/api/positions")
async def get_positions():
    """Get all available job positions"""
    return {"positions": JOB_POSITIONS}


# ============== USER MANAGEMENT ==============

@app.get("/api/users", response_model=List[schemas.UserResponse])
async def list_users(
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """List all users (manager/owner only)"""
    if current_user.role == "owner":
        users = db.query(models.User).all()
    else:
        # Managers can only see workers
        users = db.query(models.User).filter(models.User.role == "worker").all()
    return users


@app.post("/api/users", response_model=schemas.UserResponse)
async def create_user(
    user_data: schemas.UserCreate,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Create a new user"""
    # Check permissions
    if current_user.role == "manager" and user_data.role != "worker":
        raise HTTPException(status_code=403, detail="Managers can only create workers")
    
    # Check if email exists
    existing = db.query(models.User).filter(models.User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user = models.User(
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
        role=user_data.role,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.put("/api/users/{user_id}", response_model=schemas.UserResponse)
async def update_user(
    user_id: int,
    user_data: schemas.UserUpdate,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Update a user"""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Permission checks
    if current_user.role == "manager":
        if user.role != "worker":
            raise HTTPException(status_code=403, detail="Managers can only edit workers")
        if user_data.role and user_data.role != "worker":
            raise HTTPException(status_code=403, detail="Managers can only assign worker role")
    
    # Can't change own role
    if user_id == current_user.id and user_data.role and user_data.role != current_user.role:
        raise HTTPException(status_code=403, detail="Cannot change your own role")
    
    # Update fields
    if user_data.email:
        existing = db.query(models.User).filter(
            models.User.email == user_data.email,
            models.User.id != user_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = user_data.email
    
    if user_data.full_name:
        user.full_name = user_data.full_name
    if user_data.role:
        user.role = user_data.role
    if user_data.password:
        user.password_hash = get_password_hash(user_data.password)
    if user_data.is_active is not None:
        user.is_active = user_data.is_active
    
    db.commit()
    db.refresh(user)
    return user


@app.delete("/api/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Delete a user"""
    if user_id == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot delete yourself")
    
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Permission check
    if current_user.role == "manager" and user.role != "worker":
        raise HTTPException(status_code=403, detail="Managers can only delete workers")
    
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


# ============== EVENTS ==============

@app.get("/api/events", response_model=List[schemas.EventResponse])
async def list_events(
    status: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List events with optional filters"""
    query = db.query(models.Event)
    
    if status == "upcoming":
        query = query.filter(models.Event.date >= datetime.now())
    elif status == "completed" or status == "archive":
        query = query.filter(models.Event.date < datetime.now())
    
    if year:
        query = query.filter(extract('year', models.Event.date) == year)
    if month:
        query = query.filter(extract('month', models.Event.date) == month)
    
    return query.order_by(models.Event.date.desc()).all()


@app.post("/api/events", response_model=schemas.EventResponse)
async def create_event(
    event: schemas.EventCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new event"""
    db_event = models.Event(
        **event.model_dump(),
        created_by=current_user.id
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    return db_event


@app.get("/api/events/{event_id}", response_model=schemas.EventResponse)
async def get_event(
    event_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get event by ID"""
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@app.put("/api/events/{event_id}", response_model=schemas.EventResponse)
async def update_event(
    event_id: int,
    event_data: schemas.EventUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update an event"""
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    for field, value in event_data.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    
    db.commit()
    db.refresh(event)
    return event


@app.delete("/api/events/{event_id}")
async def delete_event(
    event_id: int,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Delete an event (manager/owner only)"""
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    db.delete(event)
    db.commit()
    return {"message": "Event deleted"}


# ============== CALENDAR ==============

@app.get("/api/calendar/{year}/{month}")
async def get_calendar_events(
    year: int,
    month: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get events for calendar month view"""
    events = db.query(models.Event).filter(
        extract('year', models.Event.date) == year,
        extract('month', models.Event.date) == month
    ).all()
    
    # Group by day
    calendar_data = {}
    for event in events:
        day = event.date.day
        if day not in calendar_data:
            calendar_data[day] = []
        calendar_data[day].append({
            "id": event.id,
            "name": event.name,
            "date": event.date.isoformat(),
            "genre": event.genre,
            "status": "upcoming" if event.date >= datetime.now() else "completed"
        })
    
    return calendar_data


# ============== REVENUES (Manager/Owner only) ==============

@app.get("/api/revenues", response_model=List[schemas.RevenueResponse])
async def list_revenues(
    event_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """List revenues - manager/owner only"""
    query = db.query(models.Revenue)
    
    if event_id:
        query = query.filter(models.Revenue.event_id == event_id)
    if year:
        query = query.filter(extract('year', models.Revenue.created_at) == year)
    if month:
        query = query.filter(extract('month', models.Revenue.created_at) == month)
    
    return query.order_by(models.Revenue.created_at.desc()).all()


@app.post("/api/revenues", response_model=schemas.RevenueResponse)
async def create_revenue(
    revenue: schemas.RevenueCreate,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Create revenue entry - manager/owner only"""
    db_revenue = models.Revenue(
        **revenue.model_dump(),
        created_by=current_user.id
    )
    db.add(db_revenue)
    db.commit()
    db.refresh(db_revenue)
    return db_revenue


@app.delete("/api/revenues/{revenue_id}")
async def delete_revenue(
    revenue_id: int,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Delete revenue - manager/owner only"""
    revenue = db.query(models.Revenue).filter(models.Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Revenue not found")
    
    db.delete(revenue)
    db.commit()
    return {"message": "Revenue deleted"}


# ============== COSTS (Manager/Owner only) ==============

@app.get("/api/costs", response_model=List[schemas.CostResponse])
async def list_costs(
    event_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """List costs - manager/owner only"""
    query = db.query(models.Cost)
    
    if event_id:
        query = query.filter(models.Cost.event_id == event_id)
    if year:
        query = query.filter(extract('year', models.Cost.created_at) == year)
    if month:
        query = query.filter(extract('month', models.Cost.created_at) == month)
    
    return query.order_by(models.Cost.created_at.desc()).all()


@app.post("/api/costs", response_model=schemas.CostResponse)
async def create_cost(
    cost: schemas.CostCreate,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Create cost entry - manager/owner only"""
    db_cost = models.Cost(
        **cost.model_dump(),
        created_by=current_user.id
    )
    db.add(db_cost)
    db.commit()
    db.refresh(db_cost)
    return db_cost


@app.delete("/api/costs/{cost_id}")
async def delete_cost(
    cost_id: int,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Delete cost - manager/owner only"""
    cost = db.query(models.Cost).filter(models.Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Cost not found")
    
    db.delete(cost)
    db.commit()
    return {"message": "Cost deleted"}


# ============== STAFF ASSIGNMENTS ==============

@app.get("/api/staff", response_model=List[schemas.StaffAssignmentResponse])
async def list_staff(
    event_id: Optional[int] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List staff assignments"""
    query = db.query(models.StaffAssignment)
    if event_id:
        query = query.filter(models.StaffAssignment.event_id == event_id)
    return query.all()


@app.post("/api/staff", response_model=schemas.StaffAssignmentResponse)
async def create_staff_assignment(
    staff: schemas.StaffAssignmentCreate,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Create staff assignment - manager/owner only"""
    db_staff = models.StaffAssignment(**staff.model_dump())
    db.add(db_staff)
    db.commit()
    db.refresh(db_staff)
    return db_staff


@app.delete("/api/staff/{staff_id}")
async def delete_staff_assignment(
    staff_id: int,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Delete staff assignment - manager/owner only"""
    staff = db.query(models.StaffAssignment).filter(models.StaffAssignment.id == staff_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff assignment not found")
    
    db.delete(staff)
    db.commit()
    return {"message": "Staff assignment deleted"}


# ============== DASHBOARD (Manager/Owner only for financial data) ==============

@app.get("/api/dashboard")
async def get_dashboard(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get dashboard statistics"""
    now = datetime.now()
    
    # Base queries
    events_query = db.query(models.Event)
    
    # Apply filters
    if year:
        events_query = events_query.filter(extract('year', models.Event.date) == year)
    if month:
        events_query = events_query.filter(extract('month', models.Event.date) == month)
    
    # Event stats (visible to all)
    total_events = events_query.count()
    upcoming_events = events_query.filter(models.Event.date >= now).count()
    completed_events = events_query.filter(models.Event.date < now).count()
    
    response = {
        "total_events": total_events,
        "upcoming_events": upcoming_events,
        "completed_events": completed_events,
    }
    
    # Financial data only for manager/owner
    if current_user.role in ["manager", "owner"]:
        revenue_query = db.query(func.sum(models.Revenue.amount))
        cost_query = db.query(func.sum(models.Cost.amount))
        
        if year:
            revenue_query = revenue_query.filter(extract('year', models.Revenue.created_at) == year)
            cost_query = cost_query.filter(extract('year', models.Cost.created_at) == year)
        if month:
            revenue_query = revenue_query.filter(extract('month', models.Revenue.created_at) == month)
            cost_query = cost_query.filter(extract('month', models.Cost.created_at) == month)
        
        total_revenue = revenue_query.scalar() or 0
        total_costs = cost_query.scalar() or 0
        
        response.update({
            "total_revenue": total_revenue,
            "total_costs": total_costs,
            "net_profit": total_revenue - total_costs,
            "has_financial_access": True
        })
    else:
        response["has_financial_access"] = False
    
    return response


# ============== RECEIPTS WITH OCR ==============

@app.get("/api/receipts", response_model=List[schemas.ReceiptResponse])
async def list_receipts(
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """List receipts - manager/owner only"""
    receipts = db.query(models.Receipt).order_by(models.Receipt.created_at.desc()).all()
    return receipts


@app.post("/api/receipts/scan")
async def scan_receipt(
    image: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload and scan receipt image with OCR"""
    # Read image
    image_data = await image.read()
    image_base64 = base64.b64encode(image_data).decode('utf-8')
    
    # Determine content type
    content_type = image.content_type or "image/jpeg"
    
    # Call OCR API
    ocr_result = await call_ocr_api(image_base64, content_type)
    
    # Parse OCR result
    parsed = parse_receipt_text(ocr_result.get("text", ""))
    
    # Store receipt
    receipt = models.Receipt(
        image_data=image_base64,
        image_type=content_type,
        ocr_text=ocr_result.get("text", ""),
        store_name=parsed.get("store_name"),
        total_amount=parsed.get("total_amount"),
        receipt_date=parsed.get("date"),
        uploaded_by=current_user.id,
        status="scanned"
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    
    return {
        "receipt_id": receipt.id,
        "ocr_text": ocr_result.get("text", ""),
        "parsed": parsed,
        "status": "success" if parsed.get("total_amount") else "partial"
    }


@app.get("/api/receipts/{receipt_id}/image")
async def get_receipt_image(
    receipt_id: int,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Get receipt image - manager/owner only"""
    receipt = db.query(models.Receipt).filter(models.Receipt.id == receipt_id).first()
    if not receipt or not receipt.image_data:
        raise HTTPException(status_code=404, detail="Receipt image not found")
    
    return {
        "image_data": receipt.image_data,
        "image_type": receipt.image_type
    }


@app.post("/api/receipts/{receipt_id}/create-cost")
async def create_cost_from_receipt(
    receipt_id: int,
    data: schemas.ReceiptToCost,
    current_user: models.User = Depends(require_manager_or_owner),
    db: Session = Depends(get_db)
):
    """Create cost entry from scanned receipt"""
    receipt = db.query(models.Receipt).filter(models.Receipt.id == receipt_id).first()
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    
    # Create cost
    cost = models.Cost(
        event_id=data.event_id,
        description=data.description or f"Paragon: {receipt.store_name or 'Sklep'}",
        amount=data.amount or receipt.total_amount or 0,
        category=data.category or "bar_stock",
        created_by=current_user.id
    )
    db.add(cost)
    
    # Update receipt status
    receipt.status = "processed"
    receipt.cost_id = cost.id
    
    db.commit()
    db.refresh(cost)
    
    return {"message": "Cost created", "cost_id": cost.id}


async def call_ocr_api(image_base64: str, content_type: str) -> dict:
    """Call OCR.space API"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.ocr.space/parse/image",
                data={
                    "apikey": OCR_API_KEY,
                    "base64Image": f"data:{content_type};base64,{image_base64}",
                    "language": "pol",
                    "isOverlayRequired": False,
                    "detectOrientation": True,
                    "scale": True,
                    "OCREngine": 2
                }
            )
            result = response.json()
            
            if result.get("ParsedResults"):
                return {"text": result["ParsedResults"][0].get("ParsedText", "")}
            return {"text": "", "error": result.get("ErrorMessage", "OCR failed")}
    except Exception as e:
        return {"text": "", "error": str(e)}


def parse_receipt_text(text: str) -> dict:
    """Parse receipt text to extract store, amount, date"""
    result = {
        "store_name": None,
        "total_amount": None,
        "date": None,
        "category": None
    }
    
    if not text:
        return result
    
    text_lower = text.lower()
    lines = text.split('\n')
    
    # Detect store
    for store, category in STORE_CATEGORIES.items():
        if store in text_lower:
            result["store_name"] = store.title()
            result["category"] = category
            break
    
    # Extract total amount - ENHANCED PATTERNS
    amount_patterns = [
        # Polish patterns
        r'suma\s*:?\s*pln\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'suma\s+pln\s*([\d\s]+[,.][\d]{2})',
        r'suma\s*:?\s*([\d\s]+[,.][\d]{2})\s*pln',
        r'suma\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'razem\s*:?\s*pln\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'razem\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'do\s+zap[łl]aty\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'do\s+zaplaty\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'nale[żz]no[śs][ćc]\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'naleznosc\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'warto[śs][ćc]\s+brutto\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'wartosc\s+brutto\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'brutto\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'total\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'[łl][aą]cznie\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'lacznie\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'kwota\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'zap[łl]acono\s*:?\s*([\d\s]+[,.][\d]{2})',
        r'zaplacono\s*:?\s*([\d\s]+[,.][\d]{2})',
        # Patterns with PLN/zł at end
        r'([\d\s]+[,.][\d]{2})\s*(?:pln|z[łl])\s*$',
        # Simple patterns for amounts
        r'pln\s*([\d]+[,.][\d]{2})',
        r'z[łl]\s*([\d]+[,.][\d]{2})',
    ]
    
    for pattern in amount_patterns:
        match = re.search(pattern, text_lower, re.IGNORECASE | re.MULTILINE)
        if match:
            amount_str = match.group(1).replace(' ', '').replace(',', '.')
            try:
                result["total_amount"] = float(amount_str)
                break
            except ValueError:
                continue
    
    # If still no amount, look for largest reasonable amount in text
    if not result["total_amount"]:
        all_amounts = re.findall(r'(\d+)[,.](\d{2})', text)
        if all_amounts:
            amounts = [float(f"{a}.{b}") for a, b in all_amounts if float(f"{a}.{b}") < 10000]
            if amounts:
                # Take the largest amount (usually total)
                result["total_amount"] = max(amounts)
    
    # Extract date
    date_patterns = [
        r'(\d{4}[-./]\d{2}[-./]\d{2})',  # YYYY-MM-DD
        r'(\d{2}[-./]\d{2}[-./]\d{4})',  # DD-MM-YYYY
        r'(\d{2}[-./]\d{2}[-./]\d{2})',  # DD-MM-YY
    ]
    
    for pattern in date_patterns:
        match = re.search(pattern, text)
        if match:
            result["date"] = match.group(1)
            break
    
    return result


# ============== CHAT SYSTEM ==============

class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, WebSocket] = {}
        self.typing_users: set[int] = set()
    
    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        await self.broadcast_online_users()
    
    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        self.typing_users.discard(user_id)
    
    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except:
                self.disconnect(user_id)
    
    async def broadcast(self, message: dict, exclude_user: int = None):
        disconnected = []
        for user_id, connection in self.active_connections.items():
            if user_id != exclude_user:
                try:
                    await connection.send_json(message)
                except:
                    disconnected.append(user_id)
        
        for user_id in disconnected:
            self.disconnect(user_id)
    
    async def broadcast_online_users(self):
        online_ids = list(self.active_connections.keys())
        await self.broadcast({"type": "online_users", "users": online_ids})
    
    def get_online_users(self) -> list:
        return list(self.active_connections.keys())


manager = ConnectionManager()


@app.websocket("/ws/chat/{token}")
async def websocket_chat(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    """WebSocket endpoint for chat"""
    # Verify token
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4001)
        return
    
    user_id = int(payload.get("sub"))
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        await websocket.close(code=4001)
        return
    
    await manager.connect(websocket, user_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "message":
                # Create message in database
                recipient_id = data.get("recipient_id")  # None for public, user_id for private
                
                message = models.ChatMessage(
                    sender_id=user_id,
                    recipient_id=recipient_id,
                    content=data.get("content", ""),
                    is_private=recipient_id is not None
                )
                db.add(message)
                db.commit()
                db.refresh(message)
                
                msg_data = {
                    "type": "message",
                    "id": message.id,
                    "sender_id": user_id,
                    "sender_name": user.full_name,
                    "recipient_id": recipient_id,
                    "content": message.content,
                    "is_private": message.is_private,
                    "timestamp": message.created_at.isoformat()
                }
                
                if recipient_id:
                    # Private message - send only to sender and recipient
                    await manager.send_personal_message(msg_data, user_id)
                    await manager.send_personal_message(msg_data, recipient_id)
                else:
                    # Public message - broadcast to all
                    await manager.broadcast(msg_data)
            
            elif data.get("type") == "typing":
                recipient_id = data.get("recipient_id")
                typing_data = {
                    "type": "typing",
                    "user_id": user_id,
                    "user_name": user.full_name,
                    "recipient_id": recipient_id
                }
                
                if recipient_id:
                    await manager.send_personal_message(typing_data, recipient_id)
                else:
                    await manager.broadcast(typing_data, exclude_user=user_id)
            
            elif data.get("type") == "stop_typing":
                recipient_id = data.get("recipient_id")
                stop_data = {
                    "type": "stop_typing",
                    "user_id": user_id,
                    "recipient_id": recipient_id
                }
                
                if recipient_id:
                    await manager.send_personal_message(stop_data, recipient_id)
                else:
                    await manager.broadcast(stop_data, exclude_user=user_id)
    
    except WebSocketDisconnect:
        manager.disconnect(user_id)
        await manager.broadcast_online_users()
    except Exception as e:
        manager.disconnect(user_id)
        await manager.broadcast_online_users()


@app.get("/api/chat/messages")
async def get_chat_messages(
    recipient_id: Optional[int] = None,
    limit: int = 50,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get chat messages - public or private conversation"""
    query = db.query(models.ChatMessage)
    
    if recipient_id:
        # Private conversation between current user and recipient
        query = query.filter(
            models.ChatMessage.is_private == True,
            ((models.ChatMessage.sender_id == current_user.id) & (models.ChatMessage.recipient_id == recipient_id)) |
            ((models.ChatMessage.sender_id == recipient_id) & (models.ChatMessage.recipient_id == current_user.id))
        )
    else:
        # Public messages only
        query = query.filter(models.ChatMessage.is_private == False)
    
    messages = query.order_by(models.ChatMessage.created_at.desc()).limit(limit).all()
    messages.reverse()
    
    result = []
    for msg in messages:
        sender = db.query(models.User).filter(models.User.id == msg.sender_id).first()
        result.append({
            "id": msg.id,
            "sender_id": msg.sender_id,
            "sender_name": sender.full_name if sender else "Unknown",
            "recipient_id": msg.recipient_id,
            "content": msg.content,
            "is_private": msg.is_private,
            "timestamp": msg.created_at.isoformat()
        })
    
    return result


@app.get("/api/chat/history")
async def get_chat_history(
    limit: int = 100,
    recipient_id: Optional[int] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Alias for get_chat_messages - for backwards compatibility"""
    return await get_chat_messages(
        recipient_id=recipient_id,
        limit=limit,
        current_user=current_user,
        db=db
    )


@app.get("/api/chat/online")
async def get_online_users(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of online users"""
    online_ids = manager.get_online_users()
    users = db.query(models.User).filter(models.User.id.in_(online_ids)).all() if online_ids else []
    
    return [{"id": u.id, "name": u.full_name, "role": u.role} for u in users]


@app.get("/api/chat/users")
async def get_all_chat_users(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all users for private messaging"""
    users = db.query(models.User).filter(
        models.User.is_active == True,
        models.User.id != current_user.id
    ).all()
    
    online_ids = manager.get_online_users()
    
    return [{
        "id": u.id,
        "name": u.full_name,
        "role": u.role,
        "online": u.id in online_ids
    } for u in users]


# ============== STATIC FILES ==============

# Mount frontend at /app
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_path):
    app.mount("/app", StaticFiles(directory=frontend_path, html=True), name="frontend")


@app.get("/")
async def root():
    """Redirect to app"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/app")


@app.get("/health")
async def health():
    return {"status": "healthy", "version": "4.0.0"}
