# Aggregator Integration Plan

Ye game ab **aggregator / game-provider** ki tarah kaam karega. Operator (React website + uska apna backend) apne user ko yaha bhejega, hum game chalayenge, aur result unke wallet callback pe wapas bhejenge.

- **Operator** = React website + uska backend (real paisa/wallet unke paas)
- **Aggregator (ye backend)** = sirf game chalata hai, real paisa yaha nahi rehta
- **Model** = Transfer wallet (launch pe amount reserve, round pe result report, exit pe net settle)

> Status legend: `[ ]` = pending, `[x]` = done, `[~]` = in progress

---

## Flow (high level)

```
Operator → /launch (amount + userId + callbackUrl)  →  hum: session banao → gameUrl do
                                    ↓
        Unity iframe/webview khule → socket connect (sessionToken)
                                    ↓
        Game andar chale (koi per-bet callback nahi) — fast
                                    ↓
     Round khatam → hum → operator callback (bet/win/net + signature)
                                    ↓
        Exit → bacha session balance operator ko wapas credit
```

---

## Wallet model — per-bet callback kyun NAHI (decision)

Sawaal aaya tha: har `placeBet` pe operator ki API axios se hit karni padegi kya, taaki user ka paisa kate aur wo parallel me kahin aur usi paise se na khel sake?

**Jawab: nahi.** Do models hote hain —

- **Seamless wallet** — har bet pe operator ke `/debit` pe HTTP hit. Teen Patti me ek round me ek player 10-15 chaal laga sakta hai; 5 players = 50-70 HTTP call **per round**. Har call 100-300ms, aur 30s turn window ke andar. Beech me operator timeout ho gaya to bet laga ya nahi laga — match phas jaayega, rollback API chahiye. Ye model slots/crash ke liye hai (1 spin = 1 bet), card game ke liye galat hai.
- **Transfer wallet (hum yahi use kar rahe hain)** — launch pe paisa transfer, game ke andar sab local, round end pe report, exit pe settle.

**Parallel bet ka darwaza per-bet callback se nahi, launch pe lock karne se band hota hai:**

```
Launch pe operator apne side pe:
   user.wallet     -= 5000     ← paisa main wallet se NIKAL gaya
   user.lockedInGame += 5000
   → hume bheja: { amount: 5000 }
```

Ab operator ke wallet me wo 5000 hai hi nahi — user kahin aur us paise se bet laga hi nahi sakta, chahe hum ek bhi callback na bhejein. **Operator ko ye batana zaroori hai:** launch request pe debit karo, aur hamara `success` response aane ke baad hi game kholo.

Hamari taraf se 3 guardrails (steps me niche tracked hain):
1. **One active session per user** — duplicate launch se do jagah balance na ban jaaye (Step 5 sub-item)
2. **Callback async/queued** — BullMQ se, gameplay block na ho, retry with backoff (Step 10)
3. **Idempotency** — unique `transactionId`, duplicate callback reject (Step 4)

Paisa kahan katega (sab local, zero network call bet ke time pe):

| kab | kya hota hai |
|---|---|
| boot (`startMatch`) | `coins -= boot` — sirf Mongo/Redis |
| chaal (`placeBetCore`) | `coins -= amount` — sirf Mongo/Redis |
| round end | `coins += pot` (winner) + callback **queue** me push |
| exit (`selfExit`) | bacha `coins` operator ko credit-back, `sessionClosed = true` |

---

## Payloads (reference)

### LAUNCH — Operator → Hum
`POST /api/v1/user/launch`  (single operator; `gameType` launch pe nahi — user game ke andar choose karta hai)
```json
{
  "userId": "operator-ka-user-id-98765",
  "userName": "Shivam",
  "amount": 5000,
  "currency": "INR",
  "callbackUrl": "https://operator.com/api/game-callback",
  "signature": "hmac_sha256(...)"
}
```
**Hamara response:**
```json
{ "success": true, "gameUrl": "https://game.tumhara.com/unity/?token=SESSION_TOKEN_ABC123" }
```

### RESULT CALLBACK — Hum → Operator
`POST {callbackUrl}`
```json
{
  "operatorId": "op_123",
  "userId": "operator-ka-user-id-98765",
  "walletToken": "operator-ka-wallet-session-token",
  "gameType": "zhandu",
  "roundId": "match_65f...abc",
  "betAmount": 5000,
  "winAmount": 8000,
  "netAmount": 3000,
  "result": "win",
  "transactionId": "txn_unique_001",
  "timestamp": "2026-07-31T10:20:00Z",
  "signature": "hmac_sha256(...)"
}
```
**Operator ka expected response:**
```json
{ "success": true, "balance": 13000 }
```

---

## STEPS (ek ek karke karenge)

### Phase 1 — Foundation (config + helpers)

- [x] **Step 1: Env config** — `.env` me add kiya (abhi **single operator**, isliye `operatorId` nahi rakha)
  - `AGGREGATOR_SECRET` (signature ke liye shared secret)
  - `OPERATOR_CALLBACK_URL` (single operator ka fixed callback URL — result/settle yaha jayega)
  - `GAME_BASE_URL` (Unity build ka base URL)

- [ ] **Step 2: Signature helper** — `helper/signature.helper.js`
  - `generateSignature(payload, secret)` → HMAC-SHA256 hex
  - `verifySignature(payload, signature, secret)` → boolean
  - Launch verify + callback sign dono me use hoga

### Phase 2 — Models

- [x] **Step 3: Session fields user model me add kiye** (alag session model nahi banaya — existing `user.model.js` reuse kiya)
  - Purani keys waise hi (`name`, `socketId`, `coins`)
  - Naye keys (final): `userId` (**required** — operator ka user id), `callbackUrl` (**required**), `currency`, `sessionToken`, `amount` (default 0), `sessionClosed` (Boolean, default `true`), `sessionExpiry`
  - `coins` hi session balance hai (transfer wallet)
  - Baaki validation (amount/session) launch API me — DB me nahi

- [x] **Step 4: Session archive model** — `model/gameSession.model.js`
  - ⚠️ **Design badal gaya.** Plan me `gameTransaction.model.js` tha (per-round transaction log). Ab per-round callback bhejte hi nahi (poore session ka ek hi net result jaata hai), to alag transaction model ki zaroorat nahi rahi — sab kuch isi archive doc me hai.
  - `_id` **jaan bujh ke user doc ka `_id`** rakha jaata hai → ek session ka ek hi doc, kabhi duplicate nahi. Idempotency isi se milti hai (`transactionId` ki jagah `sessionId` = ye `_id`).
  - Close-time fields: `userId`, `name`, `callbackUrl`, `currency`, `sessionToken`, `startAmount`, `launchedAt`, `closedAt`
  - Settle-time fields (worker bharta hai): `finalCoins`, `netResult`, `settlement`
  - Callback tracking: `sendCallback`, `callbackAttempts`, `lastCallbackAt`, `operatorResponse`

### Phase 3 — Launch API

- [x] **Step 5: Launch controller** — `user.controller.js` → `launch()` (game.controller ke bajaye user.controller me rakha)
  - user upsert (operator `userId` se), session token generate, `coins = amount` reserve, `sessionClosed=false`
  - callbackUrl: request > env fallback
  - `gameUrl` (`GAME_BASE_URL?token=...&gameType=...`) return
  - ⚠️ signature verify abhi TODO (Step 2 me aayega)
  - [x] **duplicate session check** — `findOne({ userId, sessionClosed: false })`, mila to **409 `"Session already active for this user."`**. Ek userId ka ek hi active session, warna operator do baar launch karke ek hi paise se do jagah balance bana leta
    - [x] **DB-level guard bhi hai** — `user.model.js` me partial unique index `{ userId: 1 }` + `partialFilterExpression: { sessionClosed: false }`. Sirf `findOne` check race-prone tha: do launch request saath me aayein to dono ka check pass ho jaata (dono ko active session nahi milta) aur do session ban jaate = ek hi paise pe do balance. Index dusre `create` ko reject karta hai; `launch()` `error.code === 11000` ko pakad ke wahi **409** return karta hai (500 nahi). Partial isliye ki settle ho chuke (`sessionClosed: true`) session pade rehte hain — ek user kai baar khel sakta hai.
    - ⚠️ Reject wala model chuna hai, matlab **Step 11.5 (expiry sweeper) ab zaroori hai** — tab band karke gaya user tab tak dobara launch nahi kar payega jab tak purana session settle na ho jaye
    - `sessionClosed` ab `create()` me explicitly nahi ja raha — user model ka `default: false` load-bearing hai, use mat badalna
  - ⚠️ **`sessionToken` me poora `gameUrl` store hota hai**, token nahi. Step 8 me auth ise match nahi karta (sirf JWT verify + `_id`/`userId` lookup) — isliye abhi kaam chal raha hai. Agar kabhi token revoke karna ho (session close pe `sessionToken: null`) to pehle ye theek karna padega.

- [x] **Step 6: Launch route + validation** — `route/v1/user.route.js`
  - `POST /api/v1/user/launch` (already `/user` index me mounted)
  - `middleware/validation.js` → `launchValidation` (userId, amount, gameType required; callbackUrl url; signature optional)

### Phase 4 — Operator callback (result bhejna)

- [x] **Step 7: Callback worker** — `worker/callbackWorker.js`
  - ⚠️ **Design badal gaya.** Plan me `helper/operatorCallback.helper.js` tha jise gameplay code call karta. Ab wo helper nahi hai — ek **BullMQ repeatable worker** hai jo khud DB se pending sessions uthaata hai (pull model). Faayda: gameplay code ko callback ka pata hi nahi hona chahiye, aur koi result kabhi kho nahi sakta.
  - Sweep har 1 min. Uthaata hai: `settlement: true` + `sendCallback: false` + `callbackAttempts < 5` + (`lastCallbackAt` null ya 5 min purani)
  - Payload: `{ sessionId, userId, initialAmount, finalAmount, netResult }`
  - Success = **HTTP 200 + `success: true` + `message: "success"`** — teeno chahiye. Tabhi `sendCallback: true`, phir wo doc dobara kabhi nahi uthega.
  - Fail → `callbackAttempts++`, `lastCallbackAt` + `operatorResponse` save, 5 min baad retry
  - **5 attempts (≈20 min) ke baad ruk jaata hai.** Doc `sendCallback: false` + `callbackAttempts: 5` ke saath pada rehta hai = manual reconciliation ka record. Anant retry se problem chhup jaati hai.
  - Cluster: BullMQ repeat key se dedupe (N instances = 1 sweep/min) + Redis lock `LOCK_TTL_MS = 20 min` (sweep 1 min se lambi ho sakti hai → overlap = double callback)
  - ⚠️ **signature abhi nahi hai** — Step 2 pending. Operator verify nahi kar sakta ki request humse aayi.

### Phase 5 — Socket auth ko session pe shift

- [x] **Step 8: Socket auth update** — `middleware/authentication.js` → `socketUserAuthentication`
  - `utils.verifyToken(token)` se JWT verify → payload se `{ _id, userId }` → `findOne({ _id, userId })`
  - Mila to `socketId` set + `disconnect: null` (banda wapas aa gaya, sweeper ise na uthaye)
  - Purana raw `_id` wala version `socketUserAuthenticationoOld` me pada hai
  - ⚠️ `sessionToken` DB se match **nahi** karta aur `sessionClosed` bhi check nahi karta — settle ho chuke session ka token abhi bhi connect kar payega. `joinRoomNew` me `sessionClosed: false` filter hai, to khel nahi payega, par connect ho jaayega.

### Phase 6 — Gameplay ko session-wallet pe hook karna

- [x] **Step 9: Bet/deduct session balance pe hai**
  - `user.coins` **hi** session balance hai (transfer wallet) — alag field banane ki zaroorat nahi padi. `startMatch` (boot) aur `placeBetCore` (bet) waise hi kaam karte hain.
  - [x] **Coins guard `placeBetCore` me** — pehle koi check tha hi nahi, balance minus me chala jaata aur pot me wo paisa aa jaata jo kabhi tha hi nahi. Ab `cancelAutoPack` se **pehle**: `betPut <= 0` (zhandu me 0 coins wala "all-in" mark ho jaata tha bina kuch daale) aur `betPut > coins` dono reject. Fold hamesha allowed.
  - [x] **Join guard `joinRoomNew` me** — table pe baithne ke liye **boot ka dugna** coins chahiye. Iske liye purana `Promise.all` todna pada (wo user read aur seat-assign saath karta tha, matlab check ka mauka hi nahi tha): ab pehle read + check, phir seat.
  - ⚠️ **`betAmount` ka upper bound abhi bhi nahi hai** — banda apne coins se zyada nahi laga sakta, par table ka current bet 10 ho to bhi apne saare coins laga sakta hai. `PENDING.md` wala raise-removal isi ka hissa hai.

- [x] **Step 10 + 11 + 11.5: Session close → settle → callback (teen alag stage)**
  - ⚠️ **Design badal gaya.** Plan me **per-round** callback tha (`resolveShowdown` etc. se `sendResult(...)`). Ab **per-session** hai — poore session ka ek hi net result jaata hai. Wajah: ek session me kai round hote hain, har round pe callback = wahi slow/complex problem jo per-bet me thi.

  - **Stage 1 — close** (`gameplay.controller.js` → `selfExit` + `_flowCloseSession`)
    - `selfExit` (socket disconnect) pe `disconnect: moment.utc().toDate()` stamp + 5 min ka `closeSession` BullMQ job
    - Disconnect pe **turant close nahi** — refresh/network drop bhi disconnect hi hai. Reconnect pe auth `disconnect: null` kar deta hai → job no-op.
    - `_flowCloseSession`: `disconnect` abhi bhi set aur 5 min purani → `sessionClosed: true` + `gameSession` archive doc banao (`_id` = user `_id`)
    - `finalCoins`/`netResult` yaha **nahi** bharte — banda disconnect ke baad bhi us match ka pot jeet sakta hai
    - Live-match check abhi commented hai

  - **Stage 2 — settle** (`worker/settlementWorker.js`)
    - Sweep har 1 min. Aggregation: `sessionClosed: true` user docs → `$lookup` matches → jinka koi `end: false` match nahi
    - Un sabka **fresh `coins`** padh ke `gameSession` me `finalCoins` + `netResult` + `settlement: true`
    - **Uske BAAD** user doc `deleteMany` — ulta kiya to coins gayab aur settle kabhi nahi hota
    - User doc ka hona hi "session in-flight hai" ka matlab hai. Doc delete = banda naya launch le sakta hai.
    - Idempotent by construction: absolute values likhta hai (`$inc` nahi), aur jo docs uthata hai unka koi live match hai hi nahi → coins badal nahi sakte

  - **Stage 3 — callback** — Step 7 dekho

  - ⚠️ `sessionExpiry` field model me hai par **launch pe set hi nahi hoti** — sab `null` hain. Abhi zaroorat nahi kyunki close disconnect se trigger hota hai, par "browser crash, socket disconnect event hi nahi aaya" wale case me kuch nahi hoga.

### Phase 7 — Testing

- [ ] **Step 12: End-to-end test**
  - dummy operator (launch call → gameUrl → socket connect → ek round khelo → disconnect → 5 min → close → settle → callback receive)
  - signature, idempotency, balance sync verify

---

## Abhi kya bacha hai

| # | kaam | kyun zaroori |
|---|---|---|
| Step 2 | `helper/signature.helper.js` | callback payload me `signature` nahi hai — operator verify nahi kar sakta ki request humse aayi. Launch me bhi verify TODO hai. |
| Step 8 ka bacha hissa | auth me `sessionClosed` check | settle ho chuke session ka token abhi bhi socket connect kar leta hai |
| Step 9 ka bacha hissa | `betAmount` upper bound (`PENDING.md`) | banda table ke current bet se kitna bhi zyada laga sakta hai |
| — | `sessionExpiry` launch pe set karna | socket disconnect event hi na aaye to session kabhi close nahi hoga |
| Step 12 | e2e test | poori chain kabhi end-to-end chalayi nahi |

**Operator ko dena hai (integration contract):**
1. Launch pe apne side pe **debit + lock** karo, hamara `success` aane ke baad hi game kholo — double-spend yahin rukta hai
2. Callback ka response **exactly** ye ho: HTTP `200` + `{ "success": true, "message": "success" }` (case-sensitive)
3. `sessionId` pe **idempotency** — ek hi sessionId 5 baar tak aa sakta hai, dobara aaye to ignore karo
4. Callback me ab **`type`** field aata hai (`appConstant.callbackType`) — operator isi se route kare:

| `type` | kab | kahan se | payload | retry |
|---|---|---|---|---|
| `launch` | session shuru hote hi, `gameUrl` dene se **pehle** | `user.controller.js → launch()` (**blocking**) | `{ type, sessionId, userId, initialAmount }` | ❌ nahi — 1 hi attempt (3s timeout) |
| `result` | session settle hone ke baad | `worker/callbackWorker.js` (sweep) | `{ type, sessionId, userId, initialAmount, finalAmount, netResult }` | ✅ 5 attempts, 5 min gap |

`sessionId` dono me **same** hota hai (= `gameSession._id` = user `_id`) — operator `launch` pe row bana ke `result` pe usi ko close kar sakta hai.

⚠️ **`launch` callback ka jawab game khulne ka gate hai.** Operator ne `200 + {success:true, message:"success"}` nahi diya (ya 3s me jawab nahi aaya) to hum session doc **delete** kar dete hain aur `400 "Launch rejected by operator."` return karte hain — koi `gameUrl` nahi. Delete isliye ki `sessionClosed:false` wala doc pada rehta to us user ka agla launch Step 5 ke `409` se block ho jaata.

---

## Notes / Decisions

- Per-bet callback **NAHI** bhejte (card game me bahut saare bets hote hain → slow + complex). Per-round bhi nahi — **poore session ka ek hi net result** jaata hai. Poori reasoning upar "Wallet model" section me.
- Double-spend rokna **operator ki launch-time debit** se hota hai, hamare callbacks se nahi. Operator ko integration doc me ye clearly likhna hai.
- Idempotency `sessionId` (= `gameSession._id` = user `_id`) se milti hai, alag `transactionId` nahi banate.
- Callback **pull model** hai (worker DB se uthata hai), push nahi. Gameplay code ko callback ka pata hi nahi hona chahiye — isse operator down hone pe game kabhi affect nahi hota.
- **Operator usi machine pe chal raha hai** — `callbackUrl` loopback pe point karna chahiye (public domain + tunnel se jaana = fizool ke failure points). `REQUEST_TIMEOUT_MS` isi wajah se 3s hai, 10s nahi.
- Do jagah BullMQ repeatable worker hai (`settlement`, `callback`). Interval (`SWEEP_MS`) kabhi badla to **purani repeat entry Redis me padi rah jaayegi aur purane interval pe firing karti rahegi** — do schedule chalne lagenge. Badalne pe `getRepeatableJobs()` se purani hatani padegi ya `bull:<queue>:repeat*` keys saaf karni padengi.
- Purana `user.coins` wallet baad me alag rakhenge ya session me merge — Step 9 pe decide karenge.
- Callbacks (result + exit settle + sweeper) sab ek hi queue se jayein — retry/backoff/idempotency ek jagah handle ho.
