"""
Music Venue Management System - FastAPI Backend
Production-ready version with environment variables
"""

import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import func

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from database import engine, get_db, Base
from models import User, Event, Cost, Revenue, FinancialReport, UserRole, CostCategory, RevenueSource
from schemas import (
    UserCreate, UserResponse, UserLogin, Token, UserUpdate,
    EventCreate, EventUpdate, EventResponse, EventListResponse,
    CostCreate, CostUpdate, CostResponse,
    RevenueCreate, RevenueUpdate, RevenueResponse,
    ReportResponse, PeriodReportResponse
)
from security import (
    verify_password, get_password_hash, create_access_token,
    verify_token, SECRET_KEY
)

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Music Venue Management System",
    description="API do zarządzania finansami klubu muzycznego",
    version="1.0.0"
)

# CORS - Production configuration
FRONTEND_URL = os.getenv("FRONTEND_URL", "*")
origins = [FRONTEND_URL] if FRONTEND_URL != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

# ==================== DEPENDENCIES ====================

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    token = credentials.credentials
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    user_id = int(payload.get("sub"))
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user

def require_role(allowed_roles: list):
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return role_checker

# ==================== STARTUP ====================

@app.on_event("startup")
async def startup_event():
    """Create default users on startup"""
    db = next(get_db())
    try:
        if db.query(User).count() == 0:
            default_users = [
                {"email": "admin@venue.com", "full_name": "Administrator", "password": "Admin123!", "role": "owner"},
                {"email": "manager@venue.com", "full_name": "Manager", "password": "Manager123!", "role": "manager"},
                {"email": "worker@venue.com", "full_name": "Pracownik", "password": "Worker123!", "role": "worker"},
            ]
            for user_data in default_users:
                user = User(
                    email=user_data["email"],
                    full_name=user_data["full_name"],
                    password_hash=get_password_hash(user_data["password"]),
                    role=user_data["role"],
                    is_active=True
                )
                db.add(user)
            db.commit()
            print("✅ Default users created")
    finally:
        db.close()

# ==================== HEALTH CHECK ====================

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute("SELECT 1")
        return {"status": "healthy", "version": "1.0.0", "database": "connected"}
    except:
        return {"status": "unhealthy", "database": "disconnected"}

@app.get("/")
def root():
    return {"message": "Music Venue API", "docs": "/docs", "health": "/health"}

# ==================== AUTH ENDPOINTS ====================

@app.post("/api/auth/login", response_model=Token)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account is deactivated")
    
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/api/auth/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user = User(
        email=user_data.email,
        full_name=user_data.full_name,
        password_hash=get_password_hash(user_data.password),
        role="worker",
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@app.get("/api/auth/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user

# ==================== USER MANAGEMENT ====================

@app.get("/api/users", response_model=list[UserResponse])
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
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = user_data.model_dump(exclude_unset=True)
    if "password" in update_data and update_data["password"]:
        update_data["password_hash"] = get_password_hash(update_data.pop("password"))
    else:
        update_data.pop("password", None)
    
    for key, value in update_data.items():
        if hasattr(user, key):
            setattr(user, key, value)
    
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
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db.delete(user)
    db.commit()
    return {"message": "User deleted"}

# ==================== EVENTS ====================

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
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    total = db.query(Event).count()
    events = db.query(Event).order_by(Event.date.desc()).offset(skip).limit(limit).all()
    return {"events": events, "total": total}

@app.get("/api/events/{event_id}", response_model=EventResponse)
def get_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
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
        raise HTTPException(status_code=404, detail="Event not found")
    
    for key, value in event_data.model_dump(exclude_unset=True).items():
        setattr(event, key, value)
    
    db.commit()
    db.refresh(event)
    return event

@app.delete("/api/events/{event_id}")
def delete_event(
    event_id: int,
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    db.delete(event)
    db.commit()
    return {"message": "Event deleted"}

# ==================== COSTS ====================

@app.post("/api/costs", response_model=CostResponse)
def create_cost(
    cost_data: CostCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == cost_data.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    cost = Cost(**cost_data.model_dump(), created_by=current_user.id)
    db.add(cost)
    db.commit()
    db.refresh(cost)
    return cost

@app.get("/api/costs/event/{event_id}", response_model=list[CostResponse])
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
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    cost = db.query(Cost).filter(Cost.id == cost_id).first()
    if not cost:
        raise HTTPException(status_code=404, detail="Cost not found")
    
    for key, value in cost_data.model_dump(exclude_unset=True).items():
        setattr(cost, key, value)
    
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
        raise HTTPException(status_code=404, detail="Cost not found")
    
    db.delete(cost)
    db.commit()
    return {"message": "Cost deleted"}

# ==================== REVENUE ====================

@app.post("/api/revenue", response_model=RevenueResponse)
def create_revenue(
    revenue_data: RevenueCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == revenue_data.event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    revenue = Revenue(**revenue_data.model_dump(), recorded_by=current_user.id)
    db.add(revenue)
    db.commit()
    db.refresh(revenue)
    return revenue

@app.get("/api/revenue/event/{event_id}", response_model=list[RevenueResponse])
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
    current_user: User = Depends(require_role(["owner", "manager"])),
    db: Session = Depends(get_db)
):
    revenue = db.query(Revenue).filter(Revenue.id == revenue_id).first()
    if not revenue:
        raise HTTPException(status_code=404, detail="Revenue not found")
    
    for key, value in revenue_data.model_dump(exclude_unset=True).items():
        setattr(revenue, key, value)
    
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
        raise HTTPException(status_code=404, detail="Revenue not found")
    
    db.delete(revenue)
    db.commit()
    return {"message": "Revenue deleted"}

# ==================== REPORTS ====================

@app.get("/api/reports/event/{event_id}", response_model=ReportResponse)
def get_event_report(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    total_costs = db.query(func.sum(Cost.amount)).filter(Cost.event_id == event_id).scalar() or 0
    total_revenue = db.query(func.sum(Revenue.amount)).filter(Revenue.event_id == event_id).scalar() or 0
    net_profit = total_revenue - total_costs
    profit_margin = (net_profit / total_revenue * 100) if total_revenue > 0 else 0
    
    # Costs breakdown
    costs_by_cat = db.query(Cost.category, func.sum(Cost.amount)).filter(
        Cost.event_id == event_id
    ).group_by(Cost.category).all()
    
    # Revenue breakdown
    revenue_by_src = db.query(Revenue.source, func.sum(Revenue.amount)).filter(
        Revenue.event_id == event_id
    ).group_by(Revenue.source).all()
    
    return {
        "event_id": event_id,
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

@app.get("/api/stats/categories")
def get_categories(current_user: User = Depends(get_current_user)):
    return {
        "cost_categories": [{"value": c.value, "label": c.value.replace("_", " ").title()} for c in CostCategory],
        "revenue_sources": [{"value": s.value, "label": s.value.replace("_", " ").title()} for s in RevenueSource],
        "user_roles": [{"value": r.value, "label": r.value.title()} for r in UserRole]
    }

# ==================== STATIC FILES (Production) ====================
# Serve frontend in production when frontend folder exists
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    @app.get("/app")
    @app.get("/app/{full_path:path}")
    async def serve_frontend(full_path: str = ""):
        file_path = frontend_path / full_path if full_path else frontend_path / "index.html"
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_path / "index.html")
    
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")
