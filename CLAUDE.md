# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Real-time multiplayer Teen Patti (Indian card game) server — Node.js + Express + Socket.IO + MongoDB + Redis.
Almost all gameplay runs over **Socket.IO**, not REST. The REST surface is tiny (`POST /api/v1/user/launch`, `POST /api/v1/user/game-history`, `POST /api/v1/admin/sign-in`, and the read-only admin-panel reports under `GET /api/v1/admin/3d-games/*` — `controller/v1/adminGames.controller.js`, documented in `ADMIN-3DGAMES-API.md`; those accept either the admin JWT or an `x-admin-key: ADMIN_API_KEY` header via `adminPanelAuthentication`).

The project is mid-migration into an **aggregator / game-provider** model (operator sends a user in with a reserved balance, we run the game, we report results back to their wallet). See `AGGREGATOR_PLAN.md` for the phase checklist — several phases are still pending.

> **`CODE_MAP.md` is the deep-dive companion to this file** — full file map, data model, the complete timed game flow, socket event catalogue, hand-evaluation reference, zhandu mechanics, and a list of known issues found while reading. Read it before any non-trivial change instead of re-deriving the codebase.

## Commands

```bash
npm run dev              # nodemon app.js  (local development)
npm start                # node app.js
npm run swagger-autogen  # regenerate swagger_output.json from swagger.js

pm2 start ecosystem.config.js   # cluster mode, `instances` = physical cores
pm2 reload teenpatti            # zero-downtime reload (matches keep running)
pm2 logs teenpatti
```

No test runner and no linter are configured (`npm test` is a stub). Verification is done by running the server and driving it with a socket client.

**MongoDB and Redis must both be running before `npm run dev`** — the process exits if Mongo is unreachable, and Redis is load-bearing (see below), not optional.

`.env` keys: `PORT`, `MONGO_CONNECT_URL`, `REDIS_URL`, `SECRET_KEY`, `SALT`, `AUTH_USER`, `AUTH_PASS`, `SERVER_URL`, `CLIENT_URL`, `COMMISSION_PERCENT` (house cut %, default 5), `ADMIN_API_KEY` (optional server-to-server key for the admin 3d-games reports; unset = JWT only), plus aggregator keys `AGGREGATOR_SECRET`, `OPERATOR_CALLBACK_URL`, `GAME_BASE_URL`. `SETUP.md` has the VPS deploy walkthrough (PM2 + Apache websocket proxy).

Swagger UI: `/swagger`. Unity WebGL build is served statically from `public/Web`.

## Architecture

### A "room" is a chain of match documents

There is **no room model**. `helper/mongoose.helper.js → createDefaultAdmin()` seeds one `match` document per room level on every boot — `roomList` in `helper/appConstant.js` is a list of games, each with a `level[]` array (Bronze..Diamond) carrying its own `roomId` ("1".."20"), boot/entry/bet limits, and a per-game `vMode` flag. Only the `roomId`s missing from the `match` collection get inserted, so deleting one room doc recreates just that one. That seeded doc is an empty, unstarted match.

When a round ends, `startNextRound()` **creates a brand new match document** carrying `roomId`, surviving `players`, and `seatPosition` forward, with `waitForNextRount: true`. So a room is a chain of match docs sharing a `roomId`, and "the room's current state" is always the newest non-ended match for that `roomId` (`.sort({ createdAt: -1 })` — this is why nearly every match lookup sorts that way).

Seats are tracked in two parallel places: `seatPosition[]` (persistent seat claim, survives across rounds) and `playersData[]` (per-round state — cards, bets, folded/seen/all-in). `checkIndex(matchData, playerId)` resolves a player to a seat index from `seatPosition`.

### Redis is not a cache add-on — four separate jobs depend on it

1. **Match state cache** (`helper/matchState.helper.js`) — while a match is live, `match:<id>` in Redis is the fast read path. `getMatch()` reads Redis, falls back to Mongo on miss and warms the cache. `updateMatch()` is **write-behind**: Redis synchronously, Mongo fire-and-forget. Mongo remains the authority for `end`/final state.
2. **Per-match distributed lock** (`helper/lock.helper.js`) — `lock:match:<id>`, token-guarded release via Lua. Prevents two simultaneous player actions from clobbering each other.
3. **BullMQ delayed jobs** (`helper/turnTimer.helper.js`) — *all* game timing.
4. **Socket.IO Redis adapter** (wired in `app.js`) — makes `io.to(room).emit` cross the PM2 cluster.

### Never use `setTimeout` for game flow

Every delay that advances a match is a BullMQ delayed job, dispatched by `startTurnWorker()` on job name:

| job | handler | purpose |
|---|---|---|
| `dealCards` | `_flowDealCards` | 5s after match start — emit cards, then schedule first `betTurn` |
| `firstJoker` | `_flowFirstJoker` | zhandu only — J1 reveal 2s before first turn |
| `betTurn` | `_flowBetTurn` | emit `betTurn` to the current player, arm the 30s auto-pack |
| `autopack` | calls `placeBet(..., {isPacked:true})` | 30s turn expiry |
| `sideShowTimeout` | `_flowSideShowTimeout` | side show request pe autopack replace karta hai — jawab na aaye to reject + requester ki chaal |
| `startNext` | `_flowStartNext` | 30s later — start the next round's match |

In-process timers were deliberately removed: a PM2 reload or a job firing on a different process would otherwise freeze the match. Every handler re-reads the match and validates (`end`, `start`, `turn` still matches) before acting, so a late or duplicate fire is a safe no-op. Preserve that property when adding jobs.

### Emit through user rooms, never socket ids

Each socket joins `user:<userId>` on connect. Use `emitToUser(io, userId, event, data)` from `helper/emit.helper.js` — it survives reconnects (socket id changes) and works across the cluster. `io.to(socketId).emit(...)` remains only for immediate error replies to the caller in the same handler.

Broadcast helpers: `sendCommonEmit` (players) and `sendCommonEmitForWatcher` (spectators — watchers are a separate array on the match). Most gameplay events must be sent to both.

`resyncMatch` is the reconnect path: it rebuilds the whole board for a client and deliberately sends only *that* user's cards, and only if they have seen them.

### Locking discipline in `gameplay.controller.js`

`placeBetCore()` does **not** take a lock — it assumes the caller already holds the match lock. The public `placeBet()` wrapper acquires it, and `respondToSideShow()`'s reject branch acquires it before delegating. Calling `placeBetCore` unlocked corrupts state; taking the lock twice for one match deadlocks against itself. If you add another entry point into the bet path, decide explicitly which side of that line it is on.

After any authoritative `findOneAndUpdate` on a live match, call `setMatch(result)` to refresh the cache; on match end, or when players/watchers change (`joinRoomNew`, `watchRoom`), call `deleteMatch()` to invalidate.

### Coins and pot

Coins move in three places: boot deducted for all players in `startMatch`, the bet amount debited per action in `placeBetCore`, and the pot credited at round end (`creditWinnerPot`, or `splitPotEqually` for draws/side pots). Folding costs nothing and must not increase the pot. Keep the invariant that pot equals total coins actually debited. Both credit helpers take a 5% house commission first (`takeCommission`, `COMMISSION_PERCENT` from `.env`, default 5) and record it via `recordPayout` — one `updateOne` that `$inc`s the match's `commission` and `$push`es a `{ playerId, amount, commission, potNo }` entry into `payouts[]` — so per round, pot = coins credited to winners + commission. Every round-end path funnels into `startNextRound`, whose tail copies the ended match to `matchHistory`, writes one `houseLedger` row from `payouts[]` (`helper/houseLedger.helper.js → saveHouseLedger`, upsert on `matchId`), and deletes it from `match`.

### Variants and hand evaluation

`gameTypeConfig` in `appConstant.js` declares `cardsPerPlayer` / `handSize` per variant (teenpatti, muflis, joker, fourcard, twocard, zhandu, flipper). Evaluation lives in `helper/utils.js`:

- `evaluateBestHand` / `evaluateBestHandWithJoker` — best `handSize` combo, wild-aware
- `compareResult` / `pickPotWinners` — winner selection; **muflis inverts the comparison** (lowest hand wins)
- `buildSidePots` — layered main/side pots from each player's total contribution; folded money counts into pots but folded players are never eligible

**Zhandu** is the most involved variant and the one most likely to break: three center jokers opened progressively (J1 at deal, J2 after round 1, J3 after round 2, keyed off `movesRound`), all-in with side pots, and per-player joker freezing — an all-in player keeps only the jokers open at the time they went all-in (`appliedJokers`, applied by `getApplicableJokerValues`). Its rules and remaining gaps are in `ZHANDU_PLAN.md`. Non-zhandu variants go down a separate, deliberately untouched branch in `placeBetCore` — don't merge the two paths.

**Flipper** (`Flipper-By-KKGrover-14042020.pdf`, `FLIPPER_PLAN.md`) is a second joker-heavy variant, in progress. It reuses `jokerCards[]` but fills it with **4 entries, all `opened: true` from match start** — index 0-2 are *variable* jokers, index 3 carries `isFixed: true`. On **every fold** the three variable jokers are replaced by the folding player's own cards (`replaceVariableJokers` in `utils.js`); the fixed one never changes. So unlike zhandu, `movesRound` plays no role and the wild set changes mid-round. Betting still goes down the classic (non-zhandu) branch of `placeBetCore` — PDF §5 says all remaining classical rules apply.

## Conventions

- **Code comments are written in Hinglish** and explain *why* a mechanism exists (what broke before). Match that style and register when editing.
- `controller/v1/gameplay.controller.md` is a companion reference describing every function in the gameplay controller. Update it when you add or change functions there.
- `controller/v1/oldv2.js` is entirely commented-out legacy. Ignore it; don't revive it.
- `model/economy.mode..js` — the double-dot filename is real, not a typo to fix; imports depend on it.
- `PENDING.md` tracks deliberate deferred work (currently: remove the raise/double-bet behaviour from `placeBet`). `SCALING.md` documents what has already been hardened and why.

## Known temporary state

`socketUserAuthentication` in `middleware/authentication.js` currently accepts the raw user `_id` as the `authorization` header — no token verification. This is test scaffolding; `AGGREGATOR_PLAN.md` Step 8 replaces it with `sessionToken` validation. The commented-out JWT version above it is the previous implementation. Don't treat the current behaviour as the intended auth model.
