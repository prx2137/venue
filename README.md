# 🎵 Music Venue Management System

Kompleksowa aplikacja webowa do zarządzania przedsiębiorstwem muzycznym z pełnym systemem autentykacji, ról i bilansowania finansowego.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Python](https://img.shields.io/badge/Python-3.8+-green)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109-teal)
![License](https://img.shields.io/badge/license-MIT-yellow)

## ✨ Funkcjonalności

### 🔐 Autentykacja & Bezpieczeństwo
- Rejestracja i logowanie użytkowników
- JWT tokens z automatycznym odświeżaniem
- Hashowanie haseł (bcrypt)
- Role-based access control (RBAC)

### 👥 Zarządzanie Użytkownikami
- Trzy role: Owner, Manager, Worker
- Profil użytkownika
- Zarządzanie użytkownikami (tylko owner)

### 📅 Zarządzanie Wydarzeniami
- Tworzenie, edycja, usuwanie wydarzeń
- Śledzenie pojemności i cen biletów
- Automatyczne kalkulacje finansowe

### 💰 Śledzenie Finansów
- **Koszty** (6 kategorii): Zatowarowanie, Sprzęt, Usługi, Personel, Transport, Inne
- **Przychody** (4 źródła): Bramka, Bar, Merchandise, Inne
- Automatyczne sumowanie per wydarzenie

### 📊 Raporty
- Raport finansowy per wydarzenie
- Raport za okres (zakres dat)
- Kalkulacja zysku netto i marży

## 🚀 Szybki Start

### Wymagania
- Python 3.8+
- pip

### Instalacja i uruchomienie

**Terminal 1 - Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
python -m http.server 8001
```

**Otwórz w przeglądarce:**
```
http://localhost:8001
```

### Domyślne Konta

| Email | Hasło | Rola |
|-------|-------|------|
| admin@venue.com | Admin123! | Owner |
| manager@venue.com | Manager123! | Manager |
| worker@venue.com | Worker123! | Worker |

⚠️ **Zmień hasła w produkcji!**

## 🏗️ Struktura Projektu

```
music-venue-app/
├── backend/
│   ├── main.py           # API endpoints
│   ├── models.py         # SQLAlchemy models
│   ├── schemas.py        # Pydantic schemas
│   ├── security.py       # JWT auth
│   ├── database.py       # DB config
│   └── requirements.txt
├── frontend/
│   ├── index.html        # SPA app
│   ├── app.js            # JavaScript logic
│   └── styles.css        # Responsive CSS
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── RENDER_DEPLOYMENT.md
├── README.md
├── QUICKSTART.md
└── render.yaml
```

## 📡 API Endpoints

### Auth (4)
- `POST /api/auth/register` - Rejestracja
- `POST /api/auth/login` - Logowanie
- `POST /api/auth/refresh` - Odświeżenie tokenu
- `GET /api/auth/me` - Profil użytkownika

### Events (5)
- `GET /api/events` - Lista wydarzeń
- `POST /api/events` - Nowe wydarzenie
- `GET /api/events/{id}` - Szczegóły
- `PATCH /api/events/{id}` - Edycja
- `DELETE /api/events/{id}` - Usunięcie

### Costs (4)
- `GET /api/costs` - Lista kosztów
- `POST /api/costs` - Nowy koszt
- `GET /api/costs/event/{id}` - Koszty wydarzenia
- `DELETE /api/costs/{id}` - Usunięcie

### Revenue (4)
- `GET /api/revenue` - Lista przychodów
- `POST /api/revenue` - Nowy przychód
- `GET /api/revenue/event/{id}` - Przychody wydarzenia
- `DELETE /api/revenue/{id}` - Usunięcie

### Reports (2)
- `GET /api/reports/event/{id}` - Raport wydarzenia
- `GET /api/reports/period` - Raport okresowy

### System (2)
- `GET /health` - Health check
- `GET /docs` - Swagger docs

## 🔧 Konfiguracja

### Zmienne środowiskowe

| Zmienna | Domyślna | Opis |
|---------|----------|------|
| `DATABASE_URL` | `sqlite:///./venue.db` | URL bazy danych |
| `SECRET_KEY` | auto-generated | Klucz JWT |
| `FRONTEND_URL` | - | URL frontendu (CORS) |

## 📱 Responsywność

Aplikacja jest w pełni responsywna i działa na:
- 📱 Telefony (iOS, Android)
- 📱 Tablety
- 💻 Laptopy
- 🖥️ Desktop

Wspierane przeglądarki:
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## 🚀 Deployment

### Render.com (Backend) + Vercel (Frontend)
Szczegóły: `docs/RENDER_DEPLOYMENT.md`

### Railway.app (Wszystko razem)
Szczegóły: `docs/RAILWAY_DEPLOYMENT.md`

## 📝 Licencja

MIT License - używaj dowolnie w projektach komercyjnych i osobistych.

---

**Enjoy your new venue management system! 🎵🎉**
