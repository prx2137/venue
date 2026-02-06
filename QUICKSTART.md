# 🚀 Quick Start - Music Venue Management System

Uruchom aplikację w 5 minut!

## Krok 1: Sklonuj/pobierz projekt

```bash
# Jeśli masz git
git clone <repo-url>
cd music-venue-app

# Lub pobierz i rozpakuj ZIP
```

## Krok 2: Uruchom Backend

Otwórz **Terminal 1**:

```bash
# Przejdź do folderu backend
cd backend

# Utwórz środowisko wirtualne Python
python -m venv venv

# Aktywuj środowisko
# Linux/Mac:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# Zainstaluj zależności
pip install -r requirements.txt

# Uruchom serwer
uvicorn main:app --reload --port 8000
```

Powinieneś zobaczyć:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Started reloader process
```

## Krok 3: Uruchom Frontend

Otwórz **Terminal 2**:

```bash
# Przejdź do folderu frontend
cd frontend

# Uruchom prosty serwer HTTP
python -m http.server 8001
```

Powinieneś zobaczyć:
```
Serving HTTP on 0.0.0.0 port 8001
```

## Krok 4: Otwórz aplikację

Otwórz przeglądarkę i przejdź do:

```
http://localhost:8001
```

## Krok 5: Zaloguj się

Użyj jednego z domyślnych kont:

| Email | Hasło | Rola | Możliwości |
|-------|-------|------|------------|
| `admin@venue.com` | `Admin123!` | Owner | Wszystko + zarządzanie użytkownikami |
| `manager@venue.com` | `Manager123!` | Manager | Wydarzenia, koszty, przychody, raporty |
| `worker@venue.com` | `Worker123!` | Worker | Tylko podgląd |

## ✅ Gotowe!

Teraz możesz:

1. **Dashboard** - Zobacz podsumowanie finansowe
2. **Wydarzenia** - Dodaj nowe wydarzenie muzyczne
3. **Koszty** - Rejestruj wydatki per wydarzenie
4. **Przychody** - Rejestruj przychody (bramka, bar, merchandise)
5. **Raporty** - Generuj raporty finansowe

## 🔧 Rozwiązywanie problemów

### Backend nie startuje?

```bash
# Sprawdź wersję Pythona (wymaga 3.8+)
python --version

# Zainstaluj ponownie zależności
pip install --upgrade pip
pip install -r requirements.txt
```

### Frontend pokazuje błąd połączenia?

1. Sprawdź czy backend działa na `http://localhost:8000`
2. Otwórz `http://localhost:8000/docs` - powinna być dokumentacja API
3. Sprawdź konsolę przeglądarki (F12)

### CORS errors?

Backend automatycznie akceptuje wszystkie originy w trybie development. Jeśli nadal są problemy, sprawdź czy oba serwery działają.

## 📱 Testowanie na telefonie

1. Znajdź swoje IP lokalne:
   ```bash
   # Windows
   ipconfig
   
   # Mac/Linux
   ifconfig
   ```

2. Uruchom backend z dostępem sieciowym:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

3. Uruchom frontend z dostępem sieciowym:
   ```bash
   python -m http.server 8001 --bind 0.0.0.0
   ```

4. Na telefonie otwórz:
   ```
   http://TWOJE_IP:8001
   ```

5. Zaktualizuj `API_URL` w `app.js` na swoje IP jeśli potrzeba

---

**Wszystko działa? Świetnie! 🎉**

Następne kroki:
- Przeczytaj `README.md` dla pełnej dokumentacji
- Sprawdź `docs/DEPLOYMENT.md` dla deployment na serwer
