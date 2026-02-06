# 🌐 Ogólny Przewodnik Deployment

## Opcje Deployment

| Platforma | Typ | Koszt | Trudność | Zalecane dla |
|-----------|-----|-------|----------|--------------|
| Render + Vercel | PaaS | Free | ⭐ Easy | Początkujący |
| Railway | PaaS | Free credit | ⭐ Easy | Wszystko w jednym |
| DigitalOcean | VPS | $5+/mies | ⭐⭐ Medium | Większa kontrola |
| AWS/GCP/Azure | Cloud | Pay-as-you-go | ⭐⭐⭐ Hard | Enterprise |
| Self-hosted | VPS | Varies | ⭐⭐⭐ Hard | Max kontrola |

## Wymagania Produkcyjne

### Backend
- Python 3.8+
- PostgreSQL (zalecane) lub SQLite
- HTTPS
- Min. 256MB RAM

### Frontend
- Serwer HTTP (nginx, Apache, CDN)
- Lub platforma statyczna (Vercel, Netlify, GitHub Pages)

## Zmienne Środowiskowe

### Wymagane

| Zmienna | Opis | Przykład |
|---------|------|----------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `SECRET_KEY` | Klucz JWT (min. 32 znaki) | `super-secret-key-min-32-chars` |

### Opcjonalne

| Zmienna | Opis | Default |
|---------|------|---------|
| `FRONTEND_URL` | URL frontendu dla CORS | `*` |
| `PORT` | Port serwera | `8000` |

## Generowanie SECRET_KEY

```python
import secrets
print(secrets.token_urlsafe(32))
```

Lub:
```bash
openssl rand -base64 32
```

## Docker Deployment

### Dockerfile (Backend)

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://venue:password@db:5432/venue
      - SECRET_KEY=your-secret-key-here
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=venue
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=venue
    volumes:
      - postgres_data:/var/lib/postgresql/data

  frontend:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./frontend:/usr/share/nginx/html:ro

volumes:
  postgres_data:
```

### Uruchomienie

```bash
docker-compose up -d
```

## nginx Configuration (Self-hosted)

```nginx
# /etc/nginx/sites-available/music-venue

server {
    listen 80;
    server_name yourdomain.com;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # Frontend
    location / {
        root /var/www/music-venue/frontend;
        try_files $uri $uri/ /index.html;
    }
    
    # Backend API
    location /api {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # API Docs
    location /docs {
        proxy_pass http://localhost:8000/docs;
    }
    
    location /health {
        proxy_pass http://localhost:8000/health;
    }
}
```

## Systemd Service (Linux)

```ini
# /etc/systemd/system/music-venue.service

[Unit]
Description=Music Venue API
After=network.target postgresql.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/music-venue/backend
Environment="PATH=/var/www/music-venue/backend/venv/bin"
Environment="DATABASE_URL=postgresql://venue:password@localhost/venue"
Environment="SECRET_KEY=your-secret-key"
ExecStart=/var/www/music-venue/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### Zarządzanie

```bash
sudo systemctl enable music-venue
sudo systemctl start music-venue
sudo systemctl status music-venue
sudo journalctl -u music-venue -f  # logi
```

## SSL/HTTPS z Let's Encrypt

```bash
# Zainstaluj certbot
sudo apt install certbot python3-certbot-nginx

# Uzyskaj certyfikat
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo certbot renew --dry-run
```

## Backup PostgreSQL

### Backup

```bash
pg_dump -U venue_user -h localhost venue > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
psql -U venue_user -h localhost venue < backup_20240201.sql
```

### Automated backup (cron)

```bash
# Edytuj crontab
crontab -e

# Dodaj (codziennie o 3:00)
0 3 * * * pg_dump -U venue venue > /backups/venue_$(date +\%Y\%m\%d).sql
```

## Monitoring

### Health Check Endpoint

```bash
curl https://yourdomain.com/health
# {"status":"healthy","version":"1.0.0","database":"connected"}
```

### Rekomendowane narzędzia

- **Uptime monitoring**: UptimeRobot (free), Pingdom
- **Error tracking**: Sentry
- **Logs**: Papertrail, LogDNA
- **Metrics**: Prometheus + Grafana

## Security Checklist

- [ ] HTTPS włączone
- [ ] Silny SECRET_KEY
- [ ] Zmienione domyślne hasła
- [ ] CORS ograniczony do konkretnych domen
- [ ] Rate limiting (nginx lub API)
- [ ] Firewall skonfigurowany
- [ ] Regularne backupy
- [ ] Monitoring włączony
- [ ] Logi rotowane
