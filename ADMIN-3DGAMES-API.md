# Admin Panel — "3D Games" tab API

Admin panel ke **3D Games** tab ke liye 4 GET APIs. Chaaro game cover hote hain:
`teenpatti`, `zhandu`, `flipper`, `variation`.

Base URL: `{SERVER_URL}/api/v1/admin`

---

## 1. Login (token lena)

```
POST /api/v1/admin/sign-in
{ "email": "...", "password": "...", "deviceType": "web", "deviceToken": "admin-panel" }
→ { "success": true, "data": { "token": "<JWT>" } }
```

Baaki saari APIs me header bhejo: `Authorization: Bearer <JWT>`
Token galat/expire → `401`.

Pehla admin server pe banta hai: `node tools/createAdmin.js <email> <password>`

---

## 2. Common query params

| Param | Value | Note |
|---|---|---|
| `game` | `teenpatti` \| `zhandu` \| `flipper` \| `variation` | na bhejo to chaaro |
| `from`, `to` | `2026-10-01` ya ISO datetime | date-only ho to `tz` ke hisaab se poora din |
| `tz` | default `Asia/Kolkata` | din ki boundary + daily chart isi se |
| `limit`, `offset` | default 20 / 0, max 100 | list APIs |

Sab amounts **coins** me hain. Galat param → `400 { success:false, message }`.

**Paise ka matlab (har jagah same):**

- `totalCollection` — us round/range me players ne pot me kitna daala (boot + saare bets)
- `commission` — house (inhouse) ka hissa, winner ki jeet ka 5% (`commissionPercent`)
- `payout` — winners ko wapas gaya = `totalCollection − commission`

Game player-vs-player hai, isliye house ka profit **sirf commission** hai.

---

## 3. `GET /3d-games/dashboard` — main screen

Params: `game`, `from`, `to`, `tz`

```jsonc
{
  "success": true,
  "data": {
    "range": { "from": null, "to": null, "tz": "Asia/Kolkata" },
    "commissionPercent": 5,
    "totals": { "rounds": 31, "totalCollection": 318000, "commission": 15900,
                "payout": 302100, "draws": 0, "uniquePlayers": 4 },
    "today":  { "rounds": 31, "totalCollection": 318000, "commission": 15900, "payout": 302100, "draws": 0 },
    "live":   { "runningTables": 0, "waitingTables": 1, "players": 2, "watchers": 0, "potOnTables": 0 },
    "games": [
      {
        "game": "teenpatti", "name": "Teen Patti",
        "rounds": 14, "totalCollection": 189000, "commission": 9450, "payout": 179550,
        "draws": 0, "uniquePlayers": 4, "lastPlayedAt": "2026-10-01T01:43:55.701Z",
        "live": { "runningTables": 0, "waitingTables": 0, "players": 0, "watchers": 0, "potOnTables": 0 },
        "tiers": [ { "tier": "Bronze", "bootAmount": 1000, "rounds": 14,
                     "totalCollection": 189000, "commission": 9450, "payout": 179550, "draws": 0 } ]
      }
      // zhandu, flipper, variation — hamesha chaaro aate hain (data na ho to 0)
    ],
    "daily": [
      { "date": "2026-10-01", "rounds": 31, "totalCollection": 318000, "commission": 15900, "payout": 302100,
        "games": { "teenpatti": { "rounds": 14, "totalCollection": 189000, "commission": 9450 },
                   "variation": { "rounds": 17, "totalCollection": 129000, "commission": 6450 } } }
    ]
  }
}
```

- `totals` / `games` / `daily` → `from`–`to` range ke (range na do to all-time)
- `today` → hamesha aaj ka (`tz` ke hisaab se), range se alag
- `live` → abhi is waqt ka, range se alag
- `uniquePlayers` → operator ke `userId` se gine jaate hain (ek user ke 10 session = 1 player)

---

## 4. `GET /3d-games/gameplay` — round-wise game play

Params: `game`, `from`, `to`, `tz`, `userId` (operator ka user id), `roomId`, `limit`, `offset`
Newest round pehle.

```jsonc
{
  "data": {
    "total": 31, "limit": 20, "offset": 0,
    "list": [
      {
        "matchId": "6abdbadb46d37d1c2ae2cbc3",
        "game": "teenpatti", "gameName": "Teen Patti",
        "gameType": "teenpatti",          // Variation room me us round ka asli variant
        "roomId": "1", "tier": "Bronze", "bootAmount": 1000,
        "totalCollection": 9000, "commission": 450, "payout": 8550,
        "isDraw": false, "playerCount": 3,
        "winners": [ { "userId": "2827848229", "name": "testr11", "won": 8550 } ],
        "players": [
          { "sessionId": "...", "userId": "7898354436", "name": "testx11", "seat": 2,
            "totalBet": 1000, "won": 0, "commission": 0, "profitLoss": -1000,
            "isWinner": false, "isPacked": true, "isSeen": false, "isAllIn": false,
            "cards": ["4H", "3D", "8S"] }
        ],
        "playedAt": "2026-10-01T01:43:55.701Z", "endedAt": "2026-10-01T01:45:28.000Z"
      }
    ]
  }
}
```

`won` = commission kat ke actual credit · `profitLoss` = `won − totalBet`.

---

## 5. `GET /3d-games/users` — kaun-kaun khela

Params: `game`, `from`, `to`, `tz`, `search` (userId ya name), `limit`, `offset`,
`sortBy` = `totalBet` (default) \| `won` \| `profitLoss` \| `commission` \| `rounds` \| `wins` \| `lastPlayed`,
`order` = `desc` (default) \| `asc`

```jsonc
{
  "data": {
    "total": 4, "limit": 20, "offset": 0,
    "list": [
      { "userId": "7898354436", "name": "testx11", "sessions": 2,
        "rounds": 31, "wins": 13, "losses": 18,
        "totalBet": 120000, "won": 171000, "profitLoss": 51000,
        "commission": 9000,                 // is user ki jeet se house ko mila
        "games": ["teenpatti", "variation"],
        "firstPlayed": "...", "lastPlayed": "..." }
    ]
  }
}
```

Kisi user pe click → uske rounds: `GET /3d-games/gameplay?userId=<userId>`

---

## 6. `GET /3d-games/live` — abhi chal rahi tables

Params: `game`

```jsonc
{
  "data": {
    "total": 1,
    "list": [
      { "matchId": "...", "game": "variation", "gameName": "Variation", "gameType": "flipper",
        "roomId": "16", "tier": "Bronze", "bootAmount": 1000,
        "status": "waiting",                // "running" | "waiting"
        "pot": 0, "currentBetAmount": 0, "watchers": 0,
        "players": [ { "sessionId": "...", "userId": "7898354436", "name": "testx11",
                       "totalBet": 0, "isPacked": false, "isSeen": false, "isAllIn": false, "isTurn": false } ],
        "startedAt": "..." }
    ]
  }
}
```

Chalte round ke **cards is API me nahi aate** (leak na ho). Round khatam hone ke baad
cards `gameplay` API me milte hain.
