# Naye Server pe Chahiye — Tools & Versions

## Install karne wale tools

| Tool | Minimum | Recommended |
|---|---|---|
| Node.js | 16.20.1 | 20 / 22 LTS |
| npm | 8 | latest |
| MongoDB | 4.2 | 6.0+ |
| Redis | 5.0.0 | 6.2.0+ (6.0.x bhi theek — sirf ek warning line aati hai) |
| PM2 | 5 | latest |
| Apache2 / Nginx | — | WebSocket proxy on |
| Certbot | — | SSL ke liye |

Bas yahi 5 tools install karne hain. Baaki sab `npm install --omit=dev` se aa jaata hai.

## Install

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo apt install -y redis-server
sudo systemctl enable --now redis-server
sudo npm i -g pm2
```

## Check

```bash
node -v              # >= v16.20.1
npm -v
redis-server -v      # >= 5.0.0
mongod --version     # >= 4.2  (Atlas ho to skip)
pm2 -v
```

## npm packages (installed versions)

| Package | Version |
|---|---|
| express | 4.22.2 |
| socket.io | 4.8.3 |
| mongoose | 8.24.3 |
| ioredis | 5.11.1 |
| bullmq | 5.81.3 |
| @socket.io/redis-adapter | 8.3.0 |
| dotenv | 16.6.1 |
| jsonwebtoken | 9.0.3 |
| bcryptjs | 2.4.3 |
| yup | 1.7.1 |
| axios | 1.19.0 |
| moment | 2.30.1 |
| multer | 1.4.5-lts.2 |
| nodemailer | 6.10.1 |
| firebase-admin | 12.7.0 |
| cors | 2.8.6 |
| morgan | 1.11.0 |
| ejs | 3.1.10 |
| swagger-ui-express | 5.0.1 |
| swagger-autogen | 2.23.7 |
| nodemon | 3.1.14 (dev only) |

```bash
npm install --omit=dev
```

## Notes

- Node 16.20.1 minimum → mongoose 8.24.3 ka requirement
- MongoDB 4.2 minimum → mongoose ke andar driver 6.20.0
- Redis 5.0.0 minimum → BullMQ startup pe check karke error deta hai
- BullMQ alag se install nahi hota — sirf library hai, jobs Redis me store hote hain
- Client Socket.IO **v4** hona chahiye (server 4.8.3)
