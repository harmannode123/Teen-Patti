# Teen Patti — Scaling Documentation

> Is project ko **kaafi zyada concurrent users** ke liye scale karne ka plan aur progress.
> Sab kuch phases me divide hai. Har phase ke "kya / kyun / fayda" yahan likha hai.

**Last updated:** 2026-06-24

---

## 📌 Quick Status

| Phase | Kaam | Status |
|-------|------|--------|
| **0** | Foundation — Redis, lock (placeBet/sideShow/respondToSideShow/**seenCard**), per-user rooms, **cache (safe read-through)** | ✅ **Done** |
| **1** | Cluster-safe banana — timers, Redis adapter, Socket.IO upgrade | 🟡 **Timers + adapter + upgrade done** (auth 1.4 baaki) |
| **2** | Cluster deploy — PM2 (tested ✅), websocket-only (no sticky needed) | 🟡 **PM2 cluster verified** (Unity websocket change + prod cutover baaki) |
| **3** | Multi-server scale-out (future) | ⬜ Pending |

### Capacity estimate (concurrent active players)

| Stage | Capacity |
|-------|----------|
| Original (kuch nahi kiya) | ~200–500 |
| Phase 0 complete (cache + lock + rooms) | ~1,500–2,000 (single server) |
| Phase 1 + 2 (4-core cluster) | ~5,000–8,000+ |
| Phase 3 (multi-server) | 50,000+ |

> "Active players" = jo actively bet/action kar rahe hain. Lobby/watchers isse zyada ho sakte hain.

---

## 🧱 Tech Stack

- **Node.js** + **Express** — HTTP/REST ([app.js](app.js))
- **Socket.IO** — real-time gameplay ([controller/v1/socket.controller.js](controller/v1/socket.controller.js))
- **MongoDB + Mongoose** — persistence (local: `mongodb://...`)
- **Redis** (ioredis) — lock + cache + (future) cluster pub-sub
- **Firebase** — push notifications

---

## 🔴 Redis Setup (zaroori — foundation)

Redis ek **Windows Service** ke roop me install hai (MongoDB jaisa, boot pe auto-start).

- **Location:** `C:\Users\dell\redis\`
- **Version:** Redis 5.0.14.1 (Windows portable build)
- **Address:** `127.0.0.1:6379`
- **Service name:** `Redis` (StartMode: **Auto**)

### Redis check karne ke commands
```powershell
Get-Service Redis                                    # Status: Running aana chahiye
& "C:\Users\dell\redis\redis-cli.exe" ping           # PONG aana chahiye
Get-CimInstance Win32_Service -Filter "Name='Redis'" | Select Name, State, StartMode
```

### Manually start/stop (agar zaroorat pade)
```powershell
Restart-Service Redis     # admin chahiye
Stop-Service Redis        # admin chahiye
# Service install na ho to portable chalane ke liye:
Start-Process -FilePath "C:\Users\dell\redis\redis-server.exe" -WindowStyle Hidden
```

### Config (.env me optional)
```
REDIS_URL=redis://127.0.0.1:6379
```
> Na ho to code default `127.0.0.1:6379` maan leta hai ([helper/redis.helper.js](helper/redis.helper.js)).

---

## ✅ PHASE 0 — Foundation

### Maqsad
1. **Race conditions fix** — coins/pot kabhi corrupt na hon.
2. **Reconnect fix** — socketId badalne par emits miss na hon.
3. **DB load kam** — har action par Mongo se baar-baar read na ho.

### Naye files banaye

| File | Kaam |
|------|------|
| [helper/redis.helper.js](helper/redis.helper.js) | Poore app ke liye **ek** Redis connection (singleton) + auto-reconnect |
| [helper/lock.helper.js](helper/lock.helper.js) | **Per-match distributed lock** — ek match par ek time ek hi action |
| [helper/matchState.helper.js](helper/matchState.helper.js) | Active match **Redis cache** (read Redis se, write-behind Mongo) — *abhi wire nahi* |
| [helper/emit.helper.js](helper/emit.helper.js) | `emitToUser()` — socketId ke bajaye `user:<id>` **room** ko emit |

### 0.1 — Distributed Lock (race-condition fix) ✅ DONE

**Problem:** `placeBet` me 30-second auto-pack timer aur player ka manual bet kabhi-kabhi *ek saath* chalte the → dono purana state padhke pot/turn/coins corrupt karte the.

**Solution:** [lock.helper.js](helper/lock.helper.js)
- `acquireLock(matchId)` — Redis `SET key NX PX` se taala. NX = sirf khaali ho to milta hai. PX = TTL safety (crash me apne aap khulta hai).
- `releaseLock(matchId, token)` — Lua script se atomic release (sirf apna taala khulta hai).
- `withLock(matchId, fn)` — sabse aasaan wrapper.

**Wiring:** [gameplay.controller.js](controller/v1/gameplay.controller.js) → `placeBet`
- Function start me: pehle match ka `_id` dhoondho → `acquireLock` → na mile to "Please retry".
- `finally` block: kaam khatam/error — taala **hamesha** chhodo.

**Fayda:** bets ab serialize. Pot/coins corruption bug khatam. 🎯

### 0.2 — Per-User Rooms (reconnect fix) ✅ DONE

**Problem:** reconnect par naya socketId banta hai. Purani socketId par bheje emit (khaaskar `setTimeout` wale — startMatch, betTurn) kahin nahi pahunchte the. Koi resync bhi nahi tha.

**Solution:**
- Connection par: `socket.join("user:" + user._id)` ([socket.controller.js](controller/v1/socket.controller.js))
- Helper: `emitToUser(io, userId, event, data)` = `io.to("user:"+userId).emit(...)` ([emit.helper.js](helper/emit.helper.js))
- Poore gameplay me **11 jagah** `io.to(player.socketId).emit()` → `emitToUser(io, player._id, ...)`
  - cards, betTurn, successPlaceBet, roundWinner, seenCard, sideShowRequest, sideShowWinner (final show), rejectSideShow, common emits (players + watchers).
- `errorLog` aur direct responses (watchRoom/fetchLobbyList) socketId par hi — woh **live requesting socket** hai (hamesha current).

**Fayda:** reconnect par emit kabhi miss nahi. Cache se socketId ki dependency hat gayi (cache ab safe). Cluster-ready (room `io.to()` adapter ke saath multi-server chalega).

### 0.3 — Redis Cache wiring ✅ DONE (safe read-through)

**Approach:** *Safe read-through* (write-behind NAHI). Mongo hamesha source-of-truth rehta hai →
crash pe coins/pot diverge nahi hote.

**Kya kiya** ([gameplay.controller.js](controller/v1/gameplay.controller.js)):
- **placeBet (hot path):** match READ ab `getMatch()` se (Redis cache; miss pe Mongo + populate + cache).
  Turn validation cache se (`turn === userId`, `start`, `!end`). Authoritative `findOneAndUpdate` ke
  baad `setMatch(result)` → cache refresh. Match-end pe `deleteMatch()`.
  - `placeBetCore` ko `matchId` hint pass hota hai (wrapper se `lockMatchId`, respondToSideShow se `_id`).
- **startMatch:** round shuru hone par `setMatch()` (cache seed → pehla bet cache-hit).
- **Baaki saare match writes** (`seenCard`, `sideShow` ×2, `respondToSideShow` ×2, `joinRoomNew`,
  `watchRoom`) → write ke baad `deleteMatch()` (cache invalidate).

**Safe-by-construction:** sirf placeBet cache se padhta hai; koi bhi dusra action cache delete kar deta
hai → placeBet kabhi stale state nahi padhta. Consecutive bets (no interleaving action) = cache-HIT →
har aise bet par **1 populated read bach jaata** (read populate Redis se). Writes abhi bhi Mongo
(authoritative).

**Fayda:** bet-heavy sequences me Mongo read-populates kaafi kam → DB load down, capacity up. Coins/pot
ka koi divergence risk nahi.

> ✅ **seenCard race FIXED:** `seenCard` me ab `placeBet` jaisa match-lock laga diya. Ab seenCard aur
> placeBet serialize hote hain → placeBet ki full `playersData` write seenCard ke `isSeen` ko overwrite
> nahi kar sakti. (Pehle ye race original code me bhi tha.) Load negligible (seenCard rare + 1 light
> query + 2 micro Redis ops).
>
> Tested live cluster pe clean boot; **poora match playthrough se verify karna baaki** (Unity client se).

### 0.4 — Lock baaki handlers me ✅ DONE
- `sideShow` me bhi `placeBet` jaisa lock laga (`turn: userId` se match `_id` → `acquireLock` → `finally` me `releaseLock`).
- `respondToSideShow` me lock laga (`sideShowUser: userId` se match `_id`).
- **Deadlock fix:** `placeBet` ka core `placeBetCore()` (module-level, **lock nahi leta**) me nikaala.
  - Public `placeBet` = lock leta hai → `placeBetCore()` chalata hai → `finally` me chhodta hai.
  - `respondToSideShow` (reject branch) pehle se lock liye hue **`placeBetCore()`** call karta hai (locked `placeBet` nahi) → same match ka taala dobara nahi maangta → **deadlock nahi**.
  - Auto-pack 30s timer (`sendBetTurnEmit`) abhi bhi **locked** `placeBet` use karta hai (independent event, sahi).

---

## ⬜ PHASE 1 — Cluster-safe banana

> Maqsad: code aisa ho ki **multiple Node process** ek saath chal sakein.

### 1.1 — Global in-memory turn-timer hatao ✅ DONE (BullMQ)
**Problem tha:** 30s turn auto-pack timer `global.turnTimers` (ek process ki memory) me tha.
- 2 process chalao → manual bet alag process pe → `clearInterval` cancel miss → stale timer galat auto-pack.
- Process crash/restart → pending timers gayab.

**Kiya:** turn-timer ko **BullMQ (Redis delayed job)** se replace kiya — naya [helper/turnTimer.helper.js](helper/turnTimer.helper.js):
- `scheduleAutoPack(matchId, playerTurnId)` — `+30s` delayed job. `matchId → jobId` ek Redis hash (`turn:autopack:jobs`) me track hota hai.
  - ⚠️ **Fixed jobId nahi** use kiya: auto-pack job khud `placeBet` → next-turn schedule karta hai jab purana job abhi *active* hai → fixed id se collision. Isliye auto-generated jobId + hash tracking.
- `cancelAutoPack(matchId)` — player time pe khele to tracked job remove.
- `startTurnWorker()` — har process boot par ([app.js](app.js)). Koi bhi worker job uthaata hai, `placeBet` (jo khud match-lock leta + turn validate karta) chalata hai → process-independent + crash pe retry (`attempts: 3`).
- Wiring ([gameplay.controller.js](controller/v1/gameplay.controller.js)): `setTimeout(...30s...)` → `scheduleAutoPack`; 3× `clearInterval(global.turnTimers...)` → `cancelAutoPack`; `global.turnTimers` declaration hata di.

**Faayda:** auto-pack ab kisi bhi process pe reliably fire/cancel hota hai. `placeBet` ka `{ turn: userId }` check late/double fire ko bhi safe banata hai.

#### 1.1b — Saare flow-timers bhi BullMQ me ✅ (reload-safety fix)
**Problem mila:** `pm2 reload` pe **chal rahe match ruk jaate the** — kyunki game ko aage badhane wale
baaki `setTimeout` abhi bhi **in-process** the (process restart pe gayab → match freeze):
- `startMatch`: 5s (cards) + 20s (pehla betTurn)
- `placeBet` / `respondToSideShow`: 2s (next betTurn)
- `startNextRound`: 5s (agla round)

**Fix:** ye saare ab BullMQ **flow jobs** ([turnTimer.helper.js](helper/turnTimer.helper.js) `scheduleFlow()`):
- Job types: `dealCards`, `betTurn`, `startNext`. Worker `job.name` se dispatch karta hai.
- Handlers ([gameplay.controller.js](controller/v1/gameplay.controller.js)): `_flowDealCards`, `_flowBetTurn`, `_flowStartNext` — match fresh load karke aage badhate hain (turn/end validate).
- `startMatch` ab cards/turn **turant DB me persist** karta hai (pehle 5s setTimeout ke andar tha); emit + flow BullMQ se.

**Faayda:** ab `pm2 reload` / process restart pe bhi **match nahi rukta** — delayed job Redis me rehta hai,
koi bhi worker due hone par uthaake match aage badha deta hai. Sirf disconnect ka chhota reconnect blip
rehta hai (neeche resync).

#### 1.1c — `resyncMatch` event ✅
Reconnect ke baad client `resyncMatch` bhejta hai → server current match state wapas (`resyncMatchSuccess`):
turn, pot, players, playersData (state-only, cards private), aur sirf apne cards (agar seen). Isse reload/
disconnect ke beech miss hue emits ke baad bhi board turant sahi ho jaata hai.
> **Unity client (app team):** reconnect (`connect`/`reconnect`) par `resyncMatch` emit karo, aur
> `resyncMatchSuccess` par board redraw karo.

> **Baaki in-memory timers (safe):** `startMatch`/next-round ke 2s/5s/20s `setTimeout` sirf sequencing hain (fire-and-forget, fire hote waqt DB se khud validate) — cross-process cancel ki zaroorat nahi, isliye waise hi rahe. `roomTimeouts`/`dashCallTimeouts` declared hain par use nahi hote.

> ⚠️ **Redis version:** BullMQ **Redis 6.2.0+** recommend karta hai; abhi **5.0.14.1** hai. Humara basic use-case (delayed add/cancel) 5.0.14.1 pe **test me chal gaya**, par production/scale pe Redis 6.2+ (Memurai for Windows, ya WSL/Docker/Linux server) pe jaana behtar.

### 1.2 — Socket.IO Redis Adapter ✅ DONE
**Problem tha:** koi adapter nahi tha ([app.js](app.js)). Process-1 ka `io.to(room)` process-2 ke sockets tak nahi pahunchta.

**Kiya:** `@socket.io/redis-adapter` install karke [app.js](app.js) me wire kiya (io banne ke turant baad):
```js
const { createAdapter } = require("@socket.io/redis-adapter");
const redis = require("./helper/redis.helper");
const pubClient = redis;             // existing singleton connection
const subClient = redis.duplicate(); // adapter ko alag sub connection chahiye
io.adapter(createAdapter(pubClient, subClient));
```
> Rooms (`user:<id>`) already use ho rahe the, to adapter lagते hi cross-process emit khud kaam karega. Single process me bhi safe (boot test pass: "Redis connected" + adapter wiring error nahi). 👍

### 1.3 — Socket.IO version upgrade ✅ ALREADY DONE
**Mila:** `package.json` me already **`socket.io@^4.8.3`** (latest v4). Alag se upgrade ki zaroorat nahi. Client SDK bhi v4 match hona chahiye (verify on app side).

### 1.4 — Auth secure karo
**Problem:** abhi token = seedha userId ([middleware/authentication.js](middleware/authentication.js) `socketUserAuthentication`). Koi bhi kisi ka account le sakta hai (JWT version commented hai).
**Fix:** JWT-based socket auth wapas chालू karo.

### 1.5 — console.log cleanup
**Problem:** har action par bahut saare `console.log` — high load par latency.
**Fix:** proper logger (pino/winston) + log level, ya production me band.

---

## 🟡 PHASE 2 — Cluster Deploy

> Maqsad: saare CPU cores + (aage) multiple machines use karna.
>
> **Chosen approach: Raasta A — WebSocket-only** (client Unity WebGL hai). Sticky session
> ki zaroorat NAHI, kyunki websocket single TCP connection ek hi process se chipka rehta hai.

### 2.1 — PM2 Cluster Mode ✅ TESTED & WORKING
Config file: [ecosystem.config.js](ecosystem.config.js) (cluster mode, `instances: max`, same PORT).
```bash
npm i -g pm2
pm2 start ecosystem.config.js     # CPU cores jitne process (same port share)
pm2 status / pm2 logs / pm2 reload teenpatti   # zero-downtime reload
pm2 stop teenpatti / pm2 delete teenpatti
```
- Har core ~500 active → 4 core = ~2,000+.

**Test result (2026-06-24):** 4-instance cluster ek free port pe chalaya — **saare online, restart count 0**,
har process me clean boot: `Redis connected` + `Turn auto-pack worker started` + `Server listening` +
`MongoDB connected`. Sab ek hi port share kar rahe the (Node cluster). **PM2 cluster Windows pe theek chalta hai.**

> ⚠️ **PORT free hona chahiye:** pehle cluster crash hua tha kyunki **PORT 9073 par pehle se ek `node app.js`
> server chal raha tha** → primary bind nahi kar paaya → `EADDRINUSE` crash-loop. (Ye Windows ki dikkat NAHI
> thi, sirf port-conflict tha.) Cluster ko **apna main server** banane ke liye: pehle purana single server
> band karo (`pm2 start` se pehle wahi PORT khaali ho), phir `pm2 start ecosystem.config.js`.

### 2.2 — Sticky Sessions ❌ NAHI CHAHIYE (websocket-only ki wajah se)
**Kyun nahi:** Unity WebGL client `transports: ["websocket"]` use karta hai → connection
single TCP socket hai jo ek hi process se bandha rehta hai → "handshake alag process pe" wali
problem hi nahi. Isliye PM2 cluster mode (same port) bina sticky LB ke chalta hai.

**Client side (Unity — app team ka kaam):**
- Socket.IO connection pe `transports: ["websocket"]` set karo (polling skip).
- Client library **v4 / Engine.IO protocol 4** ho (server `socket.io@4.8.3`), warna connect nahi hoga.

**Production (baad me):** HTTPS site se `wss://` (secure socket) chahiye → saamne **Nginx/Caddy
(TLS termination)** lagega — *sticky ke liye nahi, sirf HTTPS/wss ke liye*. Piche PM2 cluster
websocket-only hi rahega.

### 2.3 — Central state
- Redis = lock + cache + socket adapter (central).
- Mongo = persistence.
- Sab process ek hi Redis + Mongo se baat karein.

---

## ⬜ PHASE 3 — Future scale-out

- MongoDB **replica set** / sharding (read load + HA).
- **Redis cluster** (agar single Redis choke kare).
- Alag **matchmaking service**.
- **Monitoring**: Prometheus + Grafana, health-checks.
- Horizontal scale across multiple machines behind LB.

---

## 🗂️ Changed/New Files (Phase 0)

| File | Change |
|------|--------|
| [helper/redis.helper.js](helper/redis.helper.js) | NEW — Redis connection |
| [helper/lock.helper.js](helper/lock.helper.js) | NEW — distributed lock |
| [helper/matchState.helper.js](helper/matchState.helper.js) | NEW — match cache (wire pending) |
| [helper/emit.helper.js](helper/emit.helper.js) | NEW — emitToUser (rooms) |
| [controller/v1/socket.controller.js](controller/v1/socket.controller.js) | room join on connect, **`resyncMatch` event wired** |
| [controller/v1/gameplay.controller.js](controller/v1/gameplay.controller.js) | lock in placeBet, **sideShow + respondToSideShow lock**, **`placeBetCore` extract (deadlock fix)**, **BullMQ turn timer wiring**, **cache wiring (read-through: getMatch/setMatch/deleteMatch)**, all broadcasts → emitToUser |
| [helper/matchState.helper.js](helper/matchState.helper.js) | NEW (Phase 0) — match cache; ab read-through me wired |
| [helper/turnTimer.helper.js](helper/turnTimer.helper.js) | **NEW — BullMQ turn auto-pack timer + `scheduleFlow` (sab flow-timers reload-safe)** |
| [ecosystem.config.js](ecosystem.config.js) | **NEW — PM2 cluster config (websocket-only, no sticky)** |
| [app.js](app.js) | **Socket.IO Redis adapter wired** + **`startTurnWorker()` on boot** |
| `package.json` | `ioredis` + **`@socket.io/redis-adapter`** + **`bullmq`** dependency added |

---

## ✅ Next Steps (priority order)

- ~~0.4 Lock — `sideShow` + `respondToSideShow` (deadlock fix)~~ ✅ DONE
- ~~1.2 Redis adapter~~ ✅ DONE · ~~1.3 Socket.IO upgrade~~ ✅ already v4.8.3
- ~~1.1 Timers → BullMQ (cluster-safe turn timer)~~ ✅ DONE

- ~~2.1 PM2 cluster (websocket-only, no sticky)~~ ✅ TESTED & LIVE
- ~~0.3 Cache wiring (safe read-through)~~ ✅ DONE

- ~~seenCard lock (0.4 extension)~~ ✅ DONE

**Baaki (priority order):**
1. **1.4 Auth** — JWT socket auth (security). ⚠️ abhi token = seedha userId, koi bhi kisi ka account le sakta hai. Cluster ko *public* karne se pehle zaroori.
2. **1.5 logs cleanup** — `console.log` → proper logger / production me band.
3. **Unity client:** `transports: ["websocket"]` + v4 client confirm (cluster ke liye zaroori).
4. **Verify:** poora match playthrough (Unity client) — cache + lock + cluster end-to-end.

> **Cluster ready ✅:** Lock + per-user rooms + Redis adapter + BullMQ timers — sab cluster-safe ho gaye. Ab PM2 (2.1) on karna safe hai.

---

## 🧪 Testing reminders

- Code change ke baad server restart: `npm run dev`.
- Syntax check: `node -c controller/v1/gameplay.controller.js`.
- Redis chal raha hai: `Get-Service Redis` → Running.
- Ek poora match khel ke check karo: join → cards → bet → seen → sideshow → winner.
- Reconnect test: beech-game me app band-khol, emits aate rehne chahiye.
