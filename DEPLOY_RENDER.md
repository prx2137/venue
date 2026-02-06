# 🚀 Wdrożenie na Render.com (DARMOWE)

## Krok 1: Przygotowanie repozytorium GitHub

1. Utwórz nowe repozytorium na GitHub
2. Wypakuj pliki z ZIP i wrzuć je do repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/TWOJ_LOGIN/music-venue-app.git
   git push -u origin main
   ```

## Krok 2: Wdrożenie na Render.com

1. Wejdź na https://render.com i załóż darmowe konto (lub zaloguj się przez GitHub)

2. Kliknij **"New +"** → **"Web Service"**

3. Połącz swoje konto GitHub i wybierz repozytorium `music-venue-app`

4. Skonfiguruj serwis:
   | Pole | Wartość |
   |------|---------|
   | **Name** | `music-venue-app` (lub inna nazwa) |
   | **Region** | Frankfurt (EU Central) |
   | **Branch** | `main` |
   | **Runtime** | `Python 3` |
   | **Build Command** | `pip install -r backend/requirements.txt` |
   | **Start Command** | `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT` |
   | **Instance Type** | `Free` |

5. W sekcji **Environment Variables** dodaj:
   | Key | Value |
   |-----|-------|
   | `SECRET_KEY` | kliknij "Generate" lub wpisz własny min. 32-znakowy |
   | `FRONTEND_URL` | `*` |

6. Kliknij **"Create Web Service"**

7. Poczekaj ~2-3 minuty na deployment

## Krok 3: Wdrożenie frontendu

### Opcja A: Na tym samym Render (najprostsza)

Frontend jest już obsługiwany przez backend pod adresem:
```
https://twoja-app.onrender.com/app
```

### Opcja B: Osobny hosting na Netlify/Vercel (lepsza wydajność)

1. Wejdź na https://netlify.com lub https://vercel.com
2. Przeciągnij folder `frontend/` do uploadu
3. Przed wrzuceniem edytuj `frontend/config.js`:
   ```javascript
   const CONFIG = {
       API_URL: 'https://twoja-app.onrender.com'  // URL z Render
   };
   ```

## 🔗 Gotowe!

Po wdrożeniu Twoja aplikacja będzie dostępna pod adresem:
```
https://twoja-app.onrender.com
```

### Domyślne konta:
| Email | Hasło | Rola |
|-------|-------|------|
| admin@venue.com | Admin123! | Owner |
| manager@venue.com | Manager123! | Manager |
| worker@venue.com | Worker123! | Worker |

## ⚠️ Ograniczenia darmowego planu Render

- Serwis "zasypia" po 15 min nieaktywności (pierwsze wejście może trwać ~30s)
- 750 godzin/miesiąc (wystarczy na ciągłe działanie)
- SQLite - dane są resetowane przy każdym redeploy

### Dla trwałych danych (opcjonalnie):
Możesz dodać darmową bazę PostgreSQL na Render i zmienić `DATABASE_URL` w kodzie.

---

## 🆘 Problemy?

1. **500 Internal Server Error** → Sprawdź logi w dashboardzie Render
2. **CORS Error** → Upewnij się że FRONTEND_URL jest ustawione na `*`
3. **Token expired** → Wyloguj się i zaloguj ponownie
