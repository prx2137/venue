# 🚀 Deployment na Render.com + Vercel

Ten przewodnik pokaże jak wdrożyć aplikację za darmo używając:
- **Render.com** - Backend (API + baza danych)
- **Vercel** - Frontend (strona statyczna)

## Część 1: Backend na Render.com

### Krok 1: Utwórz konto na Render

1. Przejdź do [render.com](https://render.com)
2. Kliknij "Get Started for Free"
3. Zarejestruj się przez GitHub (zalecane) lub email

### Krok 2: Utwórz bazę danych PostgreSQL

1. W dashboardzie kliknij **"New +"** → **"PostgreSQL"**
2. Wypełnij:
   - **Name**: `music-venue-db`
   - **Database**: `venue`
   - **User**: `venue_user`
   - **Region**: Frankfurt (EU Central)
   - **Plan**: Free
3. Kliknij **"Create Database"**
4. **Zapisz connection string** (Internal Database URL) - będzie potrzebny!

### Krok 3: Wdróż API

1. Kliknij **"New +"** → **"Web Service"**
2. Połącz z GitHub i wybierz repo z projektem
3. Wypełnij:
   - **Name**: `music-venue-api`
   - **Region**: Frankfurt
   - **Branch**: main
   - **Root Directory**: `backend`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. W sekcji **Environment Variables** dodaj:
   ```
   DATABASE_URL = [connection string z kroku 2]
   SECRET_KEY = [wygeneruj losowy ciąg 32+ znaków]
   ```
5. Kliknij **"Create Web Service"**
6. Poczekaj na deployment (~5 min)
7. **Zapisz URL API** (np. `https://music-venue-api.onrender.com`)

### Krok 4: Testuj API

Otwórz w przeglądarce:
```
https://music-venue-api.onrender.com/docs
```

Powinny się pokazać Swagger docs.

---

## Część 2: Frontend na Vercel

### Krok 1: Utwórz konto na Vercel

1. Przejdź do [vercel.com](https://vercel.com)
2. Kliknij "Start Deploying"
3. Zarejestruj się przez GitHub

### Krok 2: Przygotuj frontend

Przed wdrożeniem, zaktualizuj URL API w `frontend/app.js`:

```javascript
// Na początku pliku app.js zmień:
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://music-venue-api.onrender.com';  // ← Twój URL z Render
```

Commit i push do GitHub.

### Krok 3: Wdróż na Vercel

1. W dashboardzie Vercel kliknij **"Add New..."** → **"Project"**
2. Import z GitHub - wybierz repo
3. Konfiguracja:
   - **Framework Preset**: Other
   - **Root Directory**: `frontend`
   - **Build Command**: (zostaw puste)
   - **Output Directory**: `.`
4. Kliknij **"Deploy"**
5. Poczekaj (~1 min)
6. **Zapisz URL** (np. `https://music-venue-app.vercel.app`)

### Krok 4: Zaktualizuj CORS na Render

1. Wróć do Render.com → Twój Web Service
2. W Environment Variables dodaj:
   ```
   FRONTEND_URL = https://music-venue-app.vercel.app
   ```
3. Deploy zrestartuje się automatycznie

---

## ✅ Gotowe!

Twoja aplikacja działa na:
- **Frontend**: `https://music-venue-app.vercel.app`
- **Backend**: `https://music-venue-api.onrender.com`
- **API Docs**: `https://music-venue-api.onrender.com/docs`

## 🔧 Rozwiązywanie problemów

### "Service is sleeping"
Darmowy plan Render usypia serwis po 15 min nieaktywności. Pierwszy request po uśpieniu może trwać ~30 sekund.

### CORS errors
Sprawdź czy `FRONTEND_URL` jest ustawiony poprawnie na Render.

### Database connection errors
- Upewnij się, że używasz **Internal Database URL**, nie External
- Sprawdź czy baza jest w tym samym regionie co API

### Build failures
Sprawdź logi w Render dashboard - często problem to brak pliku lub typo.

---

## 📊 Limity Free Tier

### Render.com
- 750 godzin/miesiąc free compute
- 256 MB RAM
- PostgreSQL: 1GB storage, 90 dni retention

### Vercel
- 100 GB bandwidth/miesiąc
- Unlimited deployments
- Custom domains

---

## 🔒 Produkcja - Checklist

Przed oddaniem do użytku:

- [ ] Zmień domyślne hasła użytkowników
- [ ] Ustaw silny `SECRET_KEY`
- [ ] Ogranicz CORS do konkretnych domen
- [ ] Włącz monitoring (Render ma wbudowany)
- [ ] Ustaw alerty na błędy
- [ ] Skonfiguruj własną domenę
