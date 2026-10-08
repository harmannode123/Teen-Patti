# Flipper (Teen Patti variation) — Implementation Plan

Source of truth: `Flipper-By-KKGrover-14042020.pdf`. Zhandu ki tarah yahan bhi har
rule ko code ke hisaab se phase-wise toda gaya hai. Step-by-step banega — ek phase
live-test hone ke baad hi agla.

---

## PDF ka nichod (5 sections)

| § | Rule |
|---|---|
| 1 | 3 variable joker (center) + **1 fixed joker** (pack ke beech se cut). **Chaaron boot ke turant baad face-up khul jaate hain** — zhandu wala progressive opening NAHI. |
| 2 | Jab bhi koi player **pack** kare, center ke 3 variable joker hatt ke uski **foldi hui cards naye joker** ban jaate hain. Purane invalid. Naye **turant sab pe apply**. 4th fixed kabhi nahi badalta. Ye har fold pe, kitni bhi baar. |
| 3 | Side show tabhi jab **saare players seen** ho **aur** requester ne **kam se kam 1 seen move** kiya ho. |
| 4 | All-in **apne aap left-hand player ke saath side-show** ban jaata (chahe koi seen na ho — dono ko cards dekhni padengi). All-in haara → uska hand fold + uski cards naye joker, process **khatam**. Left wala haara → uski cards naye joker, par process **jaari** — all-in ka hand agle left active player se phir forced side-show. Chain tab tak jab tak all-in haare ya sirf 2 bache (→ direct show). |
| 5 | Baaki sab **classical teen patti** jaisa. |

## Zhandu se farq (kya reuse hoga, kya nahi)

- ✅ **Reuse**: `jokerCards[]` array, `getOpenedJokerValues`, `evaluateBestHandWithJoker`
  (multi-wild already supports), `buildSidePots` / `pickPotWinners`, `sideShowTimeout` job,
  `emitJokerOpened` helper.
- ❌ **Reuse NAHI**: `movesRound` (flipper me progressive opening hai hi nahi — 0 hi pada rehta),
  `appliedJokers` freeze (§4 me joker freeze ka koi zikr nahi; wahan all-in ka natija side-show hai).
- 🔀 **Naya**: har fold pe wild set BADAL jaata — yani ek hi round me hand ranking
  do baar alag ho sakti. Zhandu me wild sirf BADHTE the, badalte nahi the.

---

## STATUS

- ✅ **Phase 1 — 4 joker + sab shuru me khule (§1)**
- ✅ **Phase 2 — har fold pe 3 variable joker replace (§2)**
- ✅ **Phase 3 — side show condition (§3)**
- ⏳ **Phase 4 — all-in forced side-show chain (§4)** — PENDING (decisions lock ho chuke, neeche dekho)
- ⏳ **Phase 5 — live socket test + edge cases** — PENDING

---

## Phase 1 — 4 joker, sab boot ke baad khule (§1)  ✅ DONE

**Kya bana:**
- `helper/appConstant.js` — `gameTypeConfig.flipper = { cardsPerPlayer: 3, handSize: 3 }`.
  **Pehle ye missing tha**, iske bina `gameTypeConfig[gameType]` undefined ho ke teenpatti pe
  fallback ho raha tha. (`gameTypeConstant.FLIPPER` aur `roomList` me Flipper room pehle se the.)
- `model/match.model.js` — `jokerCards[]` entry me naya flag `isFixed: Boolean`.
  Flipper me array 4 lambi: index 0-2 variable, index 3 `isFixed: true`.
- `helper/utils.js` — `buildFlipperJokers(deck)`: deck se 3+1 card `pop()`,
  **chaaron `opened: true`**, aakhri `isFixed: true`.
- `helper/utils.js` — `resolvePlayerHand` me `gameType === "flipper"` branch.
  **Ye asli bug tha**: iske bina flipper `evaluateBestHand` (bina wild) pe gir jaata
  aur poora hand ranking galat aata.
- `controller/v1/gameplay.controller.js`
  - `startMatch`: flipper branch → `buildFlipperJokers`.
  - `_flowDealCards`: flipper ke liye bhi `firstJoker` job schedule (betTurn se 2s pehle reveal).
  - `emitJokerOpened(io, match, joker, foldedBy)`: naya optional `foldedBy` param (kis fold se
    board flip hua). Payload ka `jokerCards` hamesha poora board hota hai, isliye flipper ko
    alag "saare joker" wala emit chahiye hi nahi — client wahi se chaaron padh leta hai.
  - `seenCard` ka `bestHand` aur `fetchBestHand` ab flipper pe bhi chalte hain.

## Phase 2 — har fold pe 3 variable joker replace (§2)  ✅ DONE

**Kya bana:**
- `helper/utils.js` — `replaceVariableJokers(jokerCards, foldedCards)`:
  sirf `isFixed: false` slots badalta, fixed wale ko haath nahi lagata, **naya array clone**
  karke deta (caller ka original mutate na ho — cache aur emit dono usi pe chalte).
  Cards kam/missing hui to `null` (= "kuch mat badlo") — aadha-adhoora board banane se
  poora evaluation galat ho jaata.
- `controller/v1/gameplay.controller.js` — do fold-site pe hook:
  1. `placeBetCore` ka `isPacked` — normal pack **aur** 30s `autopack` **aur**
     side-show reject wala fold, teeno yahi se guzarte hain.
  2. `respondToSideShow` ka accept-branch looser — wo bhi fold hi hai (§2 "any player at any time").
  Dono jagah naya `jokerCards` usi authoritative `findOneAndUpdate` me jaata hai
  (alag write nahi — warna cache aur DB beech me diverge ho sakte), aur uske baad
  `emitJokerOpened(io, match, jokerCards[0], foldedBy)` sab players + watchers ko.

**Testing (helper-level, `node` se):** sab pass — 4 joker bane aur chaaron khule,
exactly 1 fixed, replace pe fixed unchanged, purana array mutate nahi hota, kam/khali
cards pe board nahi badalta, baar-baar replace chalta hai.

Hand-evaluation ka before/after (same 3 cards, wilds = 2,7,8,12):

| gameType | p1 ka hand | winner |
|---|---|---|
| `flipper` (fix ke baad) | **Trail** | p1 |
| `zhandu` (reference) | Trail | p1 |
| `teenpatti` (wild nahi) | Color | p2 |

Yani fix se pehle flipper "Color" bana ke **galat banda jita raha tha**.

**Perf check:** 4 wild ranks ke saath `evaluateBestHandWithJoker` ka worst case
(player ke teeno card wild) ~270ms — zhandu ke 3-wild worst case jitna hi, koi regression nahi.

---

## Phase 3 — Side show condition (§3)  ✅ DONE

Zhandu ka §6 check (teeno joker khule + requester ka 1 seen move) flipper pe lagta hi nahi —
yahan joker hamesha khule hote hain, wo condition meaningless hai. Flipper ka §3 alag hai:
**saare bache hue players seen hon** + requester ka `seenMoves >= 1`.

**Kya bana:**
- `gameplay.controller.js` `sendBetTurnEmit` — zhandu wale `if` ke baad FLIPPER ka `else if`:
  `seenMove > 0 && allPlayersSeen` → `showEnable = true`. 2 hi bache to hamesha true
  (wo side show nahi, direct show hai).
- `gameplay.controller.js` `sideShow()` — wahi shart ka server-side guard, alag-alag error
  message ke saath ("all players have seen their cards" / "make a seen move"). Client ka
  `showEnable` sirf button chhupata hai; asli rok yahi guard hai.

## Phase 4 — All-in forced side-show chain (§4)  ⏳ PENDING

Sabse bada kaam. Abhi flipper classic (non-zhandu) branch se guzarta hai jahan all-in
ka concept hi nahi (`sendBetTurnEmit` ka `isAllIn` sirf ZHANDU pe true, aur `placeBetCore`
ka all-in block bhi `isZhandu` guard me band). Chahiye:
- All-in detect → left-hand active player ke saath **forced** side show (dono ko seen banao).
- Loser ki cards → naye jokers (Phase 2 ka helper reuse).
- All-in haara → chain khatam. Left wala haara → **chain jaari** agle left player se.
- 2 hi bache → direct show.
- Side pots (`buildSidePots` / `pickPotWinners`) — zhandu se reuse, par `appliedJokers`
  freeze **nahi** chahiye.

### Phase 4.1 — all-in detect + `allInSideShow` (ek link)  ✅ DONE

**Kya bana:**
- `gameplay.controller.js` `placeBetCore` — flipper ko zhandu wale all-in raste pe laaya,
  **minimum diff** me: `if(isZhandu)` → `if(isZhandu || isFlipper)` (bet-calculation dono me
  bilkul same hai, do copy rakhne se kal ek jagah fix aur doosri jagah bug hota),
  `!isZhandu && (betAmount < minBetPut)` wali rok me `!isFlipper` bhi, aur
  `betPut = myCoins` ab dono ke liye.
- `playersData` map me alag FLIPPER branch — sirf `isAllIn = true`, **`appliedJokers`
  bilkul nahi** (flipper me joker freeze hai hi nahi).
- `sendBetTurnEmit` ka `isAllIn` flag (client ka All-In button) ab flipper pe bhi — warna
  coins minimum bet se kam hone par player ke paas koi move hi nahi bachta tha.
- Tail routing: `isFlipper && isAllInMove` → normal `betTurn` ki jagah `allInSideShow`.
  Turn aage nahi badhta jab tak show nahi ho jaata.
- **Naya function `allInSideShow(io, matchData, allInPlayerId)`** — poora §4 ek hi jagah,
  purane `sideShow` / `respondToSideShow` ka ek line bhi nahi chheda (kal ko §4 badla to
  sirf yahi function badlega). Lock nahi leta — `placeBetCore` ka lock pehle se held hai.
- **Naya helper `nextBettorFrom`** — `turnManager` tab fail hota hai jab reference player
  khud pack/all-in ho chuka ho (wo filtered list me hota hi nahi).
- `FLIPPER_CHAIN_MS = 3000` constant (D3), `NEXT_ROUND_MS` ke saath.

**Abhi kya nahi hai:** chain. Left wala haara to §4 kehta hai process jaari rahe — filhaal
dono soorat me betting resume ho jaati hai. Code me `TODO (agla step — chain)` marker hai.

### Phase 4.2 — chain (left haara → agle left se phir show)  ⏳ PENDING

- `allInSideShow` ko khud ko dobara call karna (ya BullMQ job se, `FLIPPER_CHAIN_MS` gap pe).
- D4 wala `flipperChain: true` flag — chain ke dauraan `placeBetCore` move reject kare.
- Ruknay ki shart: all-in haara, ya sirf 2 bache (→ direct show/showdown).

### Phase 4 ke DECISIONS — ye PDF me NAHI hain, humne khud tay kiye  🔶

> PDF §4 chain ka flow to bata deta hai, par neeche wale 6 case uspe silent hain. Inka
> jawab diye bina code likha hi nahi ja sakta, isliye ye humne apne man se lock kiye hain —
> **classical teen patti + existing codebase ke behaviour ke hisaab se**. Client kal koi bhi
> rule badalne ko bole to sirf yahi section badlega, aur har point ke saath likha hai ki
> code me kahan haath lagega.

| # | Sawaal | Hamara decision | Kyun |
|---|---|---|---|
| D1 | Forced show me **DRAW** aa gaya to kaun haare? | **All-in wala haare, chain khatam** | Codebase me DRAW ka rule pehle se yahi hai — side show tie pe *jisne show maanga wo haarta* (classic + zhandu dono). Forced show ka "maangne wala" effectively all-in player hi hai. Chain bhi deterministically khatam ho jaati hai. |
| D2 | All-in poori chain jeet gaya — jinhone usse **zyada** daala tha, unka extra kiska? | **Kisi ko refund nahi — sab all-in ko** | `buildSidePots` ki eligibility `!isPacked` hai; sab fold ho chuke to har layer ka akela eligible all-in hi bachta. Folded paisa dead money hai (poker + CLAUDE.md ka invariant). Refund ka alag credit path banate to economy net-zero todne ka risk. |
| D3 | Chain ke do link ke beech kitna gap? | **3 second**, `FLIPPER_CHAIN_MS = 3000` constant | Client ko 2 hand reveal + winner animation dikhani hai. 5s pe 4-5 player ki chain ~20s lambi ho ke bore lagti. Constant isliye taaki live test me tuning ek line me ho. |
| D4 | Chain ke beech doosra player bhi all-in ho gaya to? | **Chain ke dauraan betting hi freeze** — match pe `flipperChain: true` flag, `placeBetCore` us dauraan move reject kare, autopack cancel rahe | All-in bhi kisi ke *turn* pe hi hota hai; turn hi nahi chalega to doosri chain shuru ho hi nahi sakti. Queue ka jhanjhat khatam aur PM2 cluster me do chain ka race impossible. Flag `sideShow: true` wale pattern ka hi copy hai. |
| D5 | Forced show ka haarne wala `isPacked` mane ya naya flag? | **`isPacked: true` hi** — client ko alag animation chahiye to emit payload me `reason: "forcedSideShow"` bhej denge | Existing side-show loser ke saath bilkul yahi hota hai. `buildSidePots` eligibility, `turnManager`, `sendBetTurnEmit` ka active count, Phase 2 ka joker-replace hook — sab `isPacked` pe key karte hain. Naya flag matlab ye saari jagah chhedna aur ek bhoolne pe bug. |
| D6 | §4 ka *"left player becomes Seen upon his next turn of move"* code me kaise? | Forced show hote hi **dono pe `isSeen = true`**, par **`seenMoves` 0 hi rehne do** | `isSeen` betting multiplier control karta hai — agle move se 2x lagega, PDF yahi chahta hai. `seenMoves` §3 ki side-show eligibility control karta hai — usne abhi tak koi seen *move* khela hi nahi, to turant side show maangne ka haq nahi milna chahiye. |

**D1 ka alternative** (agar client ko "tie pe all-in ka sab kuch chala jaana" zyada kadak lage):
draw pe **left wala** haare aur chain **jaari** rahe. Code me dono barabar hi kaam hai —
sirf loser choose karne wali ek line badlegi.

## Phase 5 — Live test  ⏳ PENDING

Socket client se 3-4 real users, Flipper room. Verify: board pe 4 joker, fold pe flip,
economy net-zero, resync pe sahi board, watchers ko bhi flip dikhe.

---

## Khule sawaal (user se confirm karna hai)

> Phase 4 wale 6 sawaal ab khule nahi hain — user ne confirm kar diye, "Phase 4 ke DECISIONS"
> table dekho. Neeche sirf Phase 1-2 ke bache hue sawaal hain.

**CONFIRMED (user):** fold ke baad stale best-hand ki chinta nahi — client khud
`jokerOpened` milte hi `fetchBestHand` hit karta hai. Server side bas itna chahiye tha ki
`fetchBestHand` flipper match bhi uthaye (ho gaya) aur emit se PEHLE naya board Mongo me
likha ja chuka ho (ho gaya — `findOneAndUpdate` await hota hai, phir emit jaata hai).

1. **§2 "any player at any time"** — kya round ke **aakhri** fold pe bhi (jab sirf 1 bacha,
   yani round wahin khatam) joker replace hona chahiye? Abhi ho jaata hai; showdown hi
   nahi hota to farq nahi padta, par confirm kar lein.
2. **Room seeding** — `createDefaultAdmin` sirf tab seed karta hai jab `match` collection
   BILKUL khali ho. Purane DB me Flipper rooms pehle se hain ya nahi, wo check karna hoga.
