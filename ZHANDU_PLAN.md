# Zhandu (Teen Patti variation) — Implementation Plan

Source of truth: `Zhandu-By-KKGrover-11042020.pdf`. Yahaan har rule ko code ke
hisaab se phase-wise toda gaya hai. Decisions (user-confirmed):

- **Phase-wise** banega (core pehle, advanced baad me).
- **Dealer button rotate** har round (standard teen patti).
- **All-In + Counter** ko **baad ke phase** me karenge — par PDF-complete ke liye
  honge zaroor (skip nahi).

---

## Existing system (jo reuse hoga)

- Active controller: `controller/v1/gameplay.controller.js`.
- Flow: `joinRoom` -> `startMatch` -> (5s) dealCards -> (20s) betTurn -> `placeBet`
  loop -> `sideShow`/`show` -> `roundWinner` -> `startNextRound`. Saare delay
  BullMQ jobs (`helper/turnTimer.helper.js`) -> restart-safe.
- **Single-joker variant already bana hua** hai: `startMatch` deck se 1 card cut
  karke `jokerCard` banata hai; `helper/utils.js -> evaluateBestHandWithJoker`
  us rank ko wild maan ke best hand banata hai. **Zhandu = iska "3 joker +
  progressive opening" version.**
- Card compare: `helper/utils.js -> compareResult / resolvePlayerHand`.
- State Redis me cache (`helper/matchState.helper.js`).

## Known gap (FIXED)
- **Winner ko pot/coins credit** — pehle code hi nahi tha (sirf boot deduct hota).
  ADDED: round end pe winner ko pot `$inc` (classic + zhandu). DRAW pe split.
- **Bet-debit** — betting rounds me coins deduct nahi hote the. ADDED: har bet/raise
  pe `$inc: -amount`. Ab economy net-zero.
- **[BUG FIXED] Fold pe pot badhta tha** — `$inc: pot: updatePot` fold pe bhi chalta
  tha -> phantom coins/inflation. FIX: `$inc: pot: isPacked ? 0 : updatePot`.
  Live test se confirmed: fold pe pot Δ0, NET DELTA = 0.

## Live test (socket, 3 real users, room 6) — VERIFIED
- Match start + 3 joker (J1 open) ✅
- Progressive opening: J2 @movesRound=1, J3 @movesRound=2 (button/last-active pe) ✅
- Winner ko pot credit ✅ | Fold pe pot Δ0 ✅ | Economy NET DELTA = 0 ✅
- NOTE: server `roundWinner` emit karta hai `creditWinnerPot` se PEHLE -> client ko
  winner ke naye coins turant nahi milte (koi coinsUpdate emit nahi). Chhota UX gap.

---

## STATUS (updated)
- ✅ Phase 0 — model + config
- ✅ Phase 1 — 3-joker deal + multi-wild ranking (9/9 PDF examples pass)
- ✅ Phase 2 — progressive opening (last-active-player round detect, movesRound=index)
- ✅ Phase 3a — jokerValues wiring + winner-pot credit + bet-debit (economy net-zero)
- ✅ Phase 3b — DRAW split (§8) + side-show condition (§6) + Show button-side joker (§7)
- ✅ Phase 4 — resync (jokerCards/movesRound/seenMoves) + gameType in emits
- ✅ Phase 5a/5b/5c — All-In + Side Pot + All-In Show (§5, §8-allin) — LIVE VERIFIED
      - per-player joker freeze (appliedJokers), side pots (buildSidePots),
        multi-winner resolve (pickPotWinners), pots[] DB record, economy net-zero.
      - ISOLATED: non-zhandu variants ka placeBetCore path bilkul untouched (isZhandu fork).
- ⏳ Phase 5d — Counter (§4) — PENDING (PDF me mechanic define nahi; user clarify karega)

---

## Phase 0 — Foundation (model + config)  [LOW RISK, additive]
- `gameType` enum me `"zhandu"` add (`model/match.model.js`).
- `gameTypeConfig.zhandu = { cardsPerPlayer: 3, handSize: 3 }` (`appConstant.js`).
- `appConstant.gameType.ZHANDU = "zhandu"`.
- match.model me naye fields:
  - `jokerCards: [{ card: Mixed, opened: Boolean }]` (3 entries) — single
    `jokerCard` ki jagah Zhandu ke liye.
  - `dealerButton: ObjectId` — round-completion + show rules ka reference.
  - `movesRound: Number` (0,1,2,3) — kitne "round of moves" complete hue.
- playerDataSchema me `appliedJokers: Number` (all-in phase me kaam aayega; abhi
  default = saare opened jokers).
- New socket events: `jokerOpened`. (appConstant.socketEmit)

## Phase 1 — 3 joker deal + multi-wild ranking
- `startMatch` (zhandu branch): deck se **3 card cut** -> `jokerCards`
  `[{card, opened}]`; **J1 ko opened:true** (boot ke baad), J2/J3 opened:false.
- `dealerButton` set = turn-rotation ka **aakhri** active player (jiske act pe
  round complete maana jaayega). Har naye round rotate.
- `helper/utils.js`: `evaluateBestHandWithJoker(cards, jokerValues[])` ko
  **single value -> array** generalize. Koi bhi dealt card jiska value kisi bhi
  open joker ke value se match kare = wild.
- `resolvePlayerHand`: zhandu ke liye **opened** jokers ke values ka array banaye
  aur multi-wild evaluator call kare.
- `compareResult` me `jokerValues` (array) pass karo (abhi `jokerValue` single).

## Phase 2 — Progressive joker opening
- "Round of moves complete" detection: `placeBetCore` me action ke baad —
  agar acting player == `dealerButton` (ya button pehle fold ho chuka aur turn
  wrap ho gaya) -> `movesRound++` -> agla joker `opened:true`.
  - round 1 complete -> J2 open
  - round 2 complete -> J3 open
- Joker open hone par `jokerOpened` emit (sab players + watchers).

## Phase 3 — Side Show / Show special rules + DRAW
- **Winner-pot credit** add (gap fix): round end pe winner ko `pot` `$inc`.
- **Side Show condition** (PDF 6): tabhi allowed jab **3 jokers opened** AND
  requester ne **>=1 seen move** kiya ho.
- **Side Show tie** (PDF 8): `compareResult` "DRAW" -> **requester haare**
  (requester pack), pot split nahi.
- **Show** (PDF 7): 2 player bache -> show. Requester button ke **left/right**
  ke hisaab se J2/J3 open/band:
  - left of button -> baaki jokers band rehte (kisi pe apply nahi).
  - right of button -> agla joker khulta hai dono pe apply.
- **Show / All-In Show tie** (PDF 8): pot **equally split** dono me (DRAW handle).

## Phase 4 — Polish + resync
- `resyncMatch` me `jokerCards`, `dealerButton`, `movesRound` bhejo.
- Edge cases: button fold, sab fold, 2-player-only restrictions.

## Phase 5 — All-In + Counter (PDF-complete, baad me)
- All-In move (`placeBet` me `isAllIn`), side pot banana.
- Per-player joker applicability (`appliedJokers`): all-in ke waqt jitne joker
  khule sirf utne us player pe apply.
- All-In Show: side pot compare; tie -> split.
- Counter (PDF 4): 3 joker khulne ke baad, 3+ players, 1 round counter allowed.

---

## Ranking examples (PDF Section 9) — test cases
| Dealt | Jokers | Expected (3 jokers) |
|---|---|---|
| 9D 7H 3C | 3S 7C 9C | Trail of Aces (Zhandu) |
| 9D 7H 3C | 3S 7C 3H | Trail of 9 |
| AS QD 3S | 7C 3H 4H | Sequence AKQ |
| AS QS 3S | 7C 3H 4H | Pure Sequence AKQ |
| AS AH 4D | 7C 3H 4H | Trail of Aces |
| AS AH 4D | 7C 3H AD | Trail of 4 |
| AS AH 4D | 7C 3H KD | Pair of Aces AA4 |
| 9D 7H 3D | QS 7C QH | Colour A93 |
| QS QH 9H | AC 2D 3C | Pair QQ9 |
