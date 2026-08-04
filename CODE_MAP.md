# CODE MAP — poore codebase ki samajh

> Ye file poora code padhne ke baad likhi gayi hai. Maqsad: har baar zero se code
> padhne ki zaroorat na pade. `CLAUDE.md` short summary hai (har session load hoti hai),
> ye uska **deep-dive** hai — jab kisi specific cheez ka detail chahiye tab kholo.
>
> **Last full read:** 2026-08-01

---

## 1. Ek nazar mein

Teen Patti multiplayer game server. Sab kuch **Socket.IO** pe chalta hai — REST sirf 2 endpoint hai
(`POST /api/v1/user/launch`, `POST /api/v1/admin/sign-in`). Client Unity WebGL hai (`public/Web`).

```
Unity client  ──socket──►  socket.controller  ──►  gameplay.controller  ──►  Mongo (sach)
                                                          │                    ▲
                                                          ├──► Redis cache ────┘ (write-behind)
                                                          ├──► Redis lock (per match)
                                                          └──► BullMQ jobs (saare game timers)
```

**Stack:** Node + Express + Socket.IO 4 + MongoDB (mongoose) + Redis (ioredis) + BullMQ + PM2 cluster.

---

## 2. File map (kaam ke hisaab se)

| File | Kya karta hai |
|---|---|
| `app.js` | Boot: firebase → mongo connect → Redis adapter → socket controller → BullMQ worker → express middlewares → listen. **Mongo connect fail = process exit.** |
| `controller/v1/socket.controller.js` | Sirf 8 socket event → gameplay function ki wiring. Connect pe `user:<id>` room join. |
| `controller/v1/gameplay.controller.js` | **1262 lines — poora game yahan hai.** |
| `controller/v1/gameplay.controller.md` | Us controller ke har function ka Hinglish explanation. Code badlo to ise bhi update karo. |
| `controller/v1/oldv2.js` | Poora comment kiya hua purana code. **Ignore.** |
| `controller/v1/user.controller.js` | Sirf `launch()` (aggregator entry). |
| `controller/v1/admin.controller.js` | Sirf `login()`. |
| `helper/utils.js` | JWT/bcrypt + **hand evaluation ka poora engine** + turn manager + side pots. |
| `helper/appConstant.js` | Socket event names, messages, `gameConfig`, `gameTypeConfig`, `roomList`, `variationList`. |
| `helper/redis.helper.js` | Ek singleton Redis connection. |
| `helper/lock.helper.js` | Per-match distributed lock (SET NX PX + Lua release). |
| `helper/matchState.helper.js` | Match ka Redis cache (get/set/update/delete). |
| `helper/turnTimer.helper.js` | BullMQ queue + worker. **Saare game delays yahan se.** |
| `helper/emit.helper.js` | `emitToUser()` — room-based emit. |
| `helper/mongoose.helper.js` | Boot pe rooms seed karta hai. |
| `helper/card.json` | 52 cards: `{cardId:"AC", cardValue:14, suit:"Clubs"}`. Ace = 14. |
| `middleware/authentication.js` | REST JWT auth + socket auth (**socket auth abhi kacha hai** — §10). |
| `middleware/validation.js` | Yup schemas. Zyadatar purane/unused; kaam ka sirf `launchValidation`, `adminLoginValidation`. |
| `model/*.js` | match, user, admin, economy, gameSession. |
| `ecosystem.config.js` | PM2 cluster (4 instances, cluster mode, same port). |

**Doc files:** `SCALING.md` (kya-kya scale ke liye kiya, phase-wise) · `ZHANDU_PLAN.md` (zhandu rules + status) · `AGGREGATOR_PLAN.md` (aggregator migration, adhoora) · `SETUP.md` (VPS deploy) · `PENDING.md` (jaan-boojh ke chhoda hua kaam).

---

## 3. Data model — sabse zaroori concept

### Room ka koi model nahi hai. Room = match documents ki CHAIN.

Boot pe `mongoose.helper.js → createDefaultAdmin()` rooms seed karta hai (naam bhram-jaisa hai, admin nahi banata):

```
roomList (4)         ×   variationList (5)        =   20 match docs, roomId 1..20
teenpatti, zhandu,       Bronze   1,000
flipper, variation       Silver   5,000
                         Gold     10,000
                         Platinum 50,000
                         Diamond  100,000
```

Condition: `if (checkRoom.length === 0)` — matlab **DB bilkul khaali ho tabhi** seed hota hai. Ek bhi match doc hua to skip.

Round khatam → `startNextRound()` **naya match doc** banata hai jo `roomId`, bache hue `players`, `seatPosition`, `watchers`, `gameType`, `variation` aage le jaata hai (`previousWinner` = pichla winner, `waitForNextRount: true`).

**Isliye:** "room ki current state" = us `roomId` ka **sabse naya, end:false wala** match. Code mein har jagah `.sort({ createdAt: -1 })` isi wajah se hai.

### match document ke ahem fields

```
players[]        — is round ke players (ObjectId)
exitPlayers[]    — jo beech mein nikal gaye (next round mein drop honge)
watchers[]       — spectators
seatPosition[]   — [{playerId, index}]  ← PERMANENT seat, rounds ke aar-paar
playersData[]    — [{playerId, cards[], turn, totalBet, isSeen, seenMoves,
                     isPacked, isAllIn, appliedJokers, index}]  ← PER-ROUND
turn             — abhi kiska turn (ObjectId)
pot, bootAmount, currentBetAmount
start, end, draw, winner, previousWinner
gameType, variation
jokerCard        — joker variant: 1 cut card
jokerCards[]     — zhandu: [{card, opened}] × 3
movesRound       — zhandu: sabse bada KHULA joker ka index (0/1/2)
pots[]           — all-in showdown ka record
sideShow, sideShowUser
waitForNextRount — true = abhi start mat karo, agla round schedule hai
```

**Seat do jagah hai** — `seatPosition` (permanent claim) aur `playersData[].index` (round ki copy).
`checkIndex(matchData, playerId)` hamesha `seatPosition` se padhta hai.

### baaki models

- **user** — dohra kaam kar raha hai: game player (`name`, `socketId`, `coins`) **aur** aggregator session (`userId`, `callbackUrl`, `sessionToken`, `amount`, `entryAmount`, `sessionClosed`, `sessionExpiry`). Alag session model jaan-boojh ke nahi banaya (AGGREGATOR_PLAN Step 3). `coins` hi session balance hai. `userId` aur `callbackUrl` **required** hain — matlab user sirf `/launch` se ban sakta hai.
- **economy** — `{user, matchId, betAmount}`. Sirf **boot** record hota hai (`startMatch` ka `insertMany`), baad ke bets nahi.
- **gameSession** — closed session ka archive. **Abhi kahin use nahi ho raha** (dead model).
- **admin** — email/password/deviceToken.

---

## 4. Socket events (poori list)

**Client → Server** (`socket.controller.js` mein wired):

| Event | Handler |
|---|---|
| `joinRoom` | `joinRoomNew` |
| `placeBet` | `placeBet` |
| `seenCard` | `seenCard` |
| `sideShow` | `sideShow` |
| `respondToSideShow` | `respondToSideShow` |
| `fetchLobbyList` | `fetchLobbyList` |
| `watchRoom` | `watchRoom` |
| `resyncMatch` | `resyncMatch` |
| `disconnect` | `selfExit` |

**Server → Client** (jo actually use hote hain): `joinRoomSuccess`, `matchStart`, `cardDistributeSuccess`, `betTurn`, `successPlaceBet`, `seenCardSuccess`, `sideShowRequest`, `sideShowWinner`, `rejectSideShow`, `roundWinner`, `jokerOpened`, `watchRoom`, `fetchLobbyList`, `gameList`, `resyncMatchSuccess`, `errorLog`.

`appConstant.socketEmit` mein bahut saare purane event names (`dashCall`, `trick`, `estimation`, `bidCall`…) pichle "Estimation Kingdom" project se bache hue hain — unhe ignore karo.

### Emit ka rule

`emitToUser(io, userId, event, data)` use karo — ye `user:<userId>` room ko bhejta hai. Reconnect pe socketId badalti hai, room nahi. Cluster mein Redis adapter isi ko cross-process pahunchata hai.

`io.to(socketId).emit()` sirf **usi handler ke turant reply** ke liye (errorLog, watchRoom ka response, resyncMatchSuccess) — wahan socket definitely live hai.

Broadcast helpers: `sendCommonEmit` (players) + `sendCommonEmitForWatcher` (watchers). **Zyadatar gameplay events dono ko jaate hain** — naya event add karo to watchers wala mat bhoolo.

---

## 5. Poora game flow (timing ke saath)

```
joinRoomNew (seat claim, index client bhejta hai)
   └─ players == 3 (minPlayer) && !waitForNextRount  →  startMatch()

startMatch()
   ├─ findOneAndUpdate({start:false}, {start:true})   ← ATOMIC guard, double-start nahi
   ├─ matchStart emit (players + watchers)
   ├─ economy insertMany (boot record) + sabke coins se boot MINUS
   ├─ deck shuffle → jokerCard (joker) ya jokerCards×3 (zhandu, J1 opened)
   ├─ playersData banao (cards deal, pehle player ka turn:true)
   ├─ DB write + setMatch() (cache seed)
   └─ scheduleFlow("dealCards", 5s)

_flowDealCards()  [5s baad]
   ├─ cardDistributeSuccess emit
   ├─ betTurnDelay = players.length × 4s   (fallback 20s)
   ├─ zhandu → scheduleFlow("firstJoker", betTurnDelay - 2s)
   └─ scheduleFlow("betTurn", betTurnDelay)

_flowBetTurn() → sendBetTurnEmit()
   ├─ guard: match.turn === playerTurnId  (warna skip — double emit se bacha)
   ├─ betTurn emit {timer:30, index, currentBetAmount, pot, showEnable}
   └─ scheduleAutoPack(30s)

placeBet()  [player action YA 30s autopack]
   ├─ lock lo → placeBetCore()
   ├─ cancelAutoPack
   ├─ pot/turn/playersData update + coins debit
   ├─ zhandu → round complete? → agla joker kholo → jokerOpened emit
   ├─ successPlaceBet emit
   └─ aage kaun? → scheduleFlow("betTurn", 2s)  ya  round khatam

round khatam (fold-win / showdown / show)
   ├─ roundWinner emit
   ├─ winner ko pot credit (ya draw pe split)
   ├─ match end:true + deleteMatch (cache)
   └─ startNextRound() → naya match doc → scheduleFlow("startNext", 30s)

_flowStartNext()  [30s baad]
   └─ waitForNextRount:false → players >= 3 → startMatch()
```

### Round kaise khatam hota hai — 3 raaste

1. **Fold-win** — sab pack, ek bacha. `placeBetCore` ka last `else` branch (non-zhandu) ya `resolveShowdown` (zhandu).
2. **Show** — 2 player bache, koi `sideShow` bhejta hai → `sideShow()` ka `show` branch → `compareResult` → winner ya draw.
3. **Showdown** (zhandu all-in) — koi bettor nahi bacha → `resolveShowdown` → side pots.

**Side show** (3+ players) alag cheez hai: turn wala player apne se **pichle** active player ko challenge karta hai. Wo accept/reject karta hai. Accept → haarne wala pack. Reject → requester ka normal bet lag jaata hai.

---

## 6. Teen critical rules — inhe kabhi mat todo

### 6.1 Game flow ke liye `setTimeout` NAHI

Har delay jo match ko aage badhata hai = BullMQ delayed job. Worker `job.name` se dispatch karta hai:

| job | handler | kaam |
|---|---|---|
| `dealCards` | `_flowDealCards` | cards emit + pehla betTurn schedule |
| `firstJoker` | `_flowFirstJoker` | zhandu J1 reveal |
| `betTurn` | `_flowBetTurn` | betTurn emit + 30s autopack |
| `autopack` | `placeBet(..., {isPacked:true})` | 30s turn expiry |
| `startNext` | `_flowStartNext` | agla round |

**Kyun:** in-process timer PM2 reload pe mar jaata tha → match freeze. Ab job Redis mein hai, koi bhi process uthaa leta hai.

**Har handler dobara match padhta hai aur validate karta hai** (`end`, `start`, `turn`) — isliye late ya double fire safe no-op hai. Naya job add karo to yeh property banaye rakho.

`attempts` ka farq: `autopack` = 3 (reliability chahiye), `scheduleFlow` = 1 (double betTurn emit se bachne ke liye).

### 6.2 Lock discipline

| Function | Lock leta hai? | Match kaise dhundta hai |
|---|---|---|
| `placeBet` (public) | ✅ | `{start:true, end:false, turn:userId}` |
| `placeBetCore` | ❌ **caller ka lock maan ke chalta hai** | `matchIdHint` |
| `seenCard` | ✅ | `{players:userId, start:true, end:false}` |
| `sideShow` | ✅ | `{start:true, end:false, turn:userId}` |
| `respondToSideShow` | ✅ | `{sideShow:true, sideShowUser:userId}` |

- `placeBetCore` ko **bina lock** call kiya → state corrupt.
- Ek hi match ka lock **do baar** liya → apne aap se deadlock. Isiliye `respondToSideShow` ka reject branch `placeBet` nahi, `placeBetCore` call karta hai.
- Lock hamesha `finally` mein release hota hai. `acquireLock` default: TTL 5s, wait 3s. Na mile to client ko "Please retry."

### 6.3 Cache discipline

- **Sirf `placeBetCore` cache se padhta hai** (`getMatch`). Baaki sab seedha Mongo se.
- Authoritative `findOneAndUpdate` ke baad → `setMatch(result)`.
- Match end / players ya watchers badle → `deleteMatch()`.
- Isi wajah se stale read possible hi nahi: koi bhi doosra action cache uda deta hai.
- `updateMatch()` (write-behind) helper mein hai lekin **abhi kahin use nahi ho raha** — sab jagah `setMatch`/`deleteMatch` hi hai.
- Cache TTL 1 ghanta, har write pe refresh.

---

## 7. Coins ka hisaab (economy net-zero)

| Kab | Kya |
|---|---|
| `startMatch` | sab players se `bootAmount` MINUS, pot = total boot |
| `placeBetCore` | bet lagane wale se `betPut` MINUS, pot += `betPut` |
| **Fold** | kuch nahi — **pot bhi nahi badhta** (`$inc: pot: isPacked ? 0 : updatePot`) |
| Round end | `creditWinnerPot` (pura pot) ya `splitPotEqually` (draw / side pots) |

**Invariant: pot = jitne coins actually kate.** Ye pehle toota hua tha (fold pe pot badhta tha = phantom coins) — ZHANDU_PLAN mein fix documented hai. Naya code likhte waqt ye invariant sambhalo.

`splitPotEqually` bacha hua remainder 1-1 karke baant deta hai taaki ek bhi coin gum/paida na ho.

---

## 8. Hand evaluation (`helper/utils.js`)

```
evaluateHand(3 cards)          → {rank, name, high/pairValue/kicker}
   RANKS: TRAIL 6 > PURE_SEQ 5 > SEQUENCE 4 > COLOR 3 > PAIR 2 > HIGH_CARD 1
   A-2-3 special case handle hai ("14,3,2")

compareHands(a, b)             → >0 / <0 / 0

evaluateBestHand(cards, size=3)
   cards == 3  → seedha evaluate
   cards  > 3  → (4-card) best 3-subset choose
   cards  < 3  → (2-card) deck se missing card ASSUME karke sabse strong combo

evaluateBestHandWithJoker(cards, jokerValue(s), size=3)
   jokerValue single number YA array (zhandu ke 3 wild ranks)
   jis card ka cardValue joker se match kare wo wild → har possible replacement try
   `usedCards` = final resolved cards (client display ke liye)

resolvePlayerHand(cards, ctx)  → variant ke hisaab se sahi evaluator chunta hai
compareEvaluatedHands(a,b,gt)  → MUFLIS yahan comparison ULTA karta hai
compareResult(p1, p2, ctx)     → {winner|"DRAW", player1:{bestCards,hand}, player2:{...}}
```

**Performance note:** `evaluateBestHandWithJoker` mein agar 2-3 joker cards hain to `getCardCombinations(49-50 cards, 2 or 3)` chalta hai = hazaaron combos, aur har ek pe `evaluateBestHand`. Zhandu showdown mein ye bhaari pad sakta hai.

**Turn helpers:**
- `turnManager(playersData, current)` → agla bettor. `isPacked` **aur** `isAllIn` dono skip. 1 ya 0 bache to `null`.
- `sideShowTurnManager(playersData, current)` → **pichla** active player (side show ka target).

**Side pots:** `buildSidePots(playersData, bootAmount)` — har player ka contribution = boot + totalBet. Sabse chhote level se layer-by-layer pot bante hain. **Folded players ka paisa pots mein jaata hai (dead money) par wo eligible nahi.** `pickPotWinners(entries, gameType)` har pot ka winner nikaalta hai (tie = multiple winners).

---

## 9. Variants

`gameTypeConfig` (appConstant): `cardsPerPlayer` aur `handSize`.

| Variant | Deal | Hand | Khaasiyat |
|---|---|---|---|
| `teenpatti` | 3 | 3 | base |
| `muflis` | 3 | 3 | ranking ulti (sabse kamzor jeetta) |
| `joker` | 3 | 3 | 1 cut card ka rank wild |
| `fourcard` | 4 | 3 | best 3 choose |
| `twocard` | 2 | 3 | teesra card assume |
| `zhandu` | 3 | 3 | 3 progressive joker + all-in + side pots |

`placeBetCore` mein **zhandu ka alag fork hai** (`isZhandu`). Non-zhandu path jaan-boojh ke chhua nahi gaya — dono ko merge mat karo.

### Zhandu ki mechanics

- Deck se 3 card cut → `jokerCards[{card, opened}]`. **J1 shuru se opened.**
- `isZhanduRoundComplete(matchData, justActedId)`: active players ko seat-index se sort karo; agar abhi act karne wala **aakhri** tha to round poora. Fold karne wala bhi ginta hai. All-in skip.
- Round poora + 2+ active → `movesRound++` → `jokerCards[movesRound]` khulta hai → `jokerOpened` emit. (round 1 → J2, round 2 → J3)
- **All-in:** `isAllIn` flag, saare bache coins pot mein. `appliedJokers` **freeze** ho jaata hai — round 0 mein all-in = 2 joker, round 1+ = 3. `getApplicableJokerValues` isi ka `slice(0, appliedJokers)` leta hai.
- **Side show** tabhi allowed jab (a) teeno joker khule ho AND (b) requester ne ≥1 seen move kiya ho.
- **Show** pe agar requester button (sabse bada index) hai to ek aur joker khulta hai.
- **Draw:** show/showdown mein pot equally split. Side show mein draw = **requester haarta** (koi split nahi).

Poori rules + status `ZHANDU_PLAN.md` mein. Phase 5d (Counter) pending hai — PDF mein mechanic define nahi.

---

## 10. Aggregator migration (adhoora)

Ye game ab **game provider** ban raha hai: operator apne user ko `/launch` se bhejta hai, hum game chalate hain, result unke wallet callback pe bhejte hain.

**Ho chuka:** `.env` keys, user model ke session fields, `launch()` controller, `launchValidation`.

**Baaki (AGGREGATOR_PLAN.md):**
- Step 2 — `helper/signature.helper.js` (HMAC-SHA256) — launch verify + callback sign
- Step 4 — `gameTransaction.model.js` (idempotency)
- Step 7 — `operatorCallback.helper.js` (result POST + retry)
- **Step 8 — socket auth ko `sessionToken` pe le jaana** ⚠️
- Step 9/10/11 — bet/win ko session balance pe hook karna, round end pe callback, exit pe settle

### ⚠️ Socket auth abhi surakshit NAHI hai

`socketUserAuthentication` abhi `authorization` header mein **seedha user `_id`** leta hai aur usi se user dhundta hai — koi token verify nahi. Koi bhi kisi ka account le sakta hai. JWT wala purana version upar comment mein pada hai. Ye test scaffolding hai, intended design nahi. (SCALING.md 1.4 + AGGREGATOR Step 8)

---

## 11. Padhte waqt mile hue issues

Ye **fix nahi kiye gaye**, sirf note kiye hain:

1. **`sideShow` mein `await setTimeout(...)`** (~line 687) — `setTimeout` promise nahi lautata, `await` bekaar. Aur ye in-process timer hai → `pm2 reload` pe ye `roundWinner` emit gayab. Baaki poora code BullMQ pe shift ho chuka, sirf yahi reh gaya.
2. **`fetchLobbyList` `flipper`/`variation` reject karta hai** — `gameTypeConstant` mein ye do hain hi nahi, par `roomList` inke 10 rooms seed karta hai. Wo rooms lobby se pahunch se bahar hain.
3. **`launch()` mein `sessionToken: gameUrl`** save ho raha hai — token ki jagah poora URL. Step 8 jab sessionToken validate karega to match nahi karega.
4. **`sideShow` ke lock query mein `.sort({createdAt:-1})` nahi hai** (data query mein hai) — theoretically alag match lock ho sakta hai.
5. **Firebase service-account private key `helper/firebase.config.js` mein hardcoded** — asli credential source mein hai. `.env` mein jaana chahiye.
6. **`roomList()` dead code** — `socketEmit.fetchRoomList` exist hi nahi karta (undefined event name), aur function kisi socket event se wired bhi nahi.
7. **`startNextRound` ka comment "5s baad" kehta hai par code 30000 (30s) hai.**
8. **`gameSession` model kahin use nahi ho raha.**
9. **`middleware/validation.js` ka 90% dead hai** — purane project ke schemas (friend, shop, subscription…) jinke routes hi nahi.
10. **`console.log` bahut zyada hai** har hot path mein (SCALING 1.5) — load pe latency.

Iske alawa jaan-boojh ke chhoda hua kaam: **`PENDING.md`** (raise/double-bet hatana hai).

---

## 12. Kaam karne ke practical notes

```bash
npm run dev                       # nodemon
node -c controller/v1/gameplay.controller.js   # syntax check (koi linter nahi hai)
pm2 reload teenpatti              # zero-downtime, match nahi rukta
```

- **Mongo + Redis dono chalne chahiye** warna boot fail.
- Koi test suite nahi hai. Verify karne ka tareeka = server chalao + socket client se poora match khelo (join → cards → bet → seen → sideshow → winner) + reconnect test.
- **Comments Hinglish mein hain** aur "kyun" batate hain (pehle kya toota tha). Same style rakho.
- `gameplay.controller.md` ko controller ke saath sync rakho.
- `model/economy.mode..js` — double dot naam **jaan-boojh ke** hai (imports uspe depend karte hain), typo samajh ke fix mat karo.
- `swagger_output.json` `npm run swagger-autogen` se banti hai. **Note:** `swagger.js` generate ke baad `app.js` require kar leta hai — matlab command server bhi start kar deta hai.
