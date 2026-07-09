# ⚡ Teen Patti — VPS pe ab kya karna hai

**Status:** Code VPS pe upload ho gaya hai. Node.js + PM2 + Apache2 already hain.
Ab bas neeche ke steps ek-ek karke karo. 👇

---

## Step 1 — Redis (zaroori — lock/cache/timer isi pe chalte hain)
```bash
redis-cli ping
```
- `PONG` aaya → Redis hai, **Step 2** pe jao.
- error / not found → install:
```bash
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping        # ab PONG
```

## Step 2 — MongoDB check
```bash
mongod --version
```
- version aaya → hai, aage badho.
- nahi hai → install karna padega (ya MongoDB Atlas cloud). Bata dena, command de dunga.

## Step 3 — Project folder + dependencies
```bash
cd /var/www/teenpatti        # jahan code upload kiya wahan
npm install --omit=dev
```

## Step 4 — `.env` banao
```bash
nano .env
```
```ini
PORT = 6773
MONGO_CONNECT_URL = mongodb://127.0.0.1:27017/ctp
REDIS_URL = redis://127.0.0.1:6379
SECRET_KEY = <apna_secret>
SALT = 10
AUTH_USER = <gmail>
AUTH_PASS = <gmail_app_password>
```
> `REDIS_URL` zaroor daalo (naya hai). Save: `Ctrl+O`, exit: `Ctrl+X`.

## Step 5 — cores dekho + ecosystem set karo
```bash
nproc                         # e.g. 4
nano ecosystem.config.js      # instances: <cores jitne> kar do
```

## Step 6 — App start 🚀
```bash
pm2 start ecosystem.config.js
pm2 status                    # sab "online", ↺ = 0
pm2 logs teenpatti --lines 20 # "Redis connected / Server listening / Mongo connected" dikhe
```

## Step 7 — Reboot pe auto-start
```bash
pm2 save
pm2 startup                   # jo command aaye usse copy-paste karke chalao
pm2 save
```
✅ Ab app `127.0.0.1:6773` pe chal raha hai.

---

## Step 8 — Apache2 me WebSocket proxy (Unity ke liye)
```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite
sudo systemctl restart apache2
```
Apni site config ke `<VirtualHost>` ke andar daalo:
```apache
RewriteEngine On
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule ^/?(.*) ws://127.0.0.1:6773/$1 [P,L]

ProxyPreserveHost On
ProxyPass / http://127.0.0.1:6773/
ProxyPassReverse / http://127.0.0.1:6773/
```
```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```
SSL (https + wss):
```bash
sudo certbot --apache -d your-domain.com
```

---

## 🔁 Code change ke baad (har baar bas ye)
```bash
cd /var/www/teenpatti && git pull
pm2 reload teenpatti          # zero-downtime, match nahi rukta
```

## 🎮 Unity client
- URL: `wss://your-domain.com`
- `transports: ["websocket"]`, Socket.IO **v4** client
- reconnect par `resyncMatch` emit → `resyncMatchSuccess` par board redraw

---

### Abhi: Step 1 aur 2 ka output bata do (Redis + Mongo hai ya nahi) — uske hisaab se aage exact batata hoon.
```
