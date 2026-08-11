# Gameplay Controller — Function Reference

`controller/v1/gameplay.controller.js` ke sabhi functions ka documentation. (Function ke andar wale inline comments code me hi hain; ye file sirf har function ke "bahar" wale explanation ko rakhti hai.)

## Module notes

- **Dependencies:** upar require blocks — appConstant, models (room/user/match/economy), card deck, aur helpers (utils, lock, emit, turnTimer, matchState).
- **Global variables:** `global.roomTimeouts` aur `global.dashCallTimeouts`.
- **`global.turnTimers` hata diya** — turn auto-pack timer ab BullMQ (Redis) me hai (`helper/turnTimer.helper.js`), process-memory me nahi → cluster-safe.

---

## Helper functions (module-private)

### `shuffle(deck)`
Deck ka shuffled copy return karta hai (Fisher–Yates). Original array mutate nahi hota.

### `sortPlayerAccSeat(matchData)`
Match ke players ko unke seat-index (`checkIndex`) ke hisaab se ascending order me sort karke return karta hai. Invalid index (< 0) wale players filter ho jaate hain.

---

## ZHANDU helpers

### `isZhanduRoundComplete(matchData, justActedId)`
PDF Section 2: "round of moves" complete hua ya nahi (button store kiye bina). Tareeka: abhi ke ACTIVE (`isPacked=false`) players ko seat-index se sort karo. Jo abhi khela (`justActedId`) agar is list ka AAKHRI player tha → ek round poora ho gaya.
- `justActedId` ko khud bhi gino chahe usne abhi FOLD kiya ho (PDF: "makes a move OR Folds") → isiliye filter me usko OR se include karte hain.
- Fold hone par "last active" naturally agle player par shift ho jaata → PDF ka "button fold ho chuka to right-of-button tak" wala case bhi isi se cover ho jaata.
- All-in player bet nahi karta → use bhi skip karo (par abhi jisne act kiya usko include karo, chahe wo fold/all-in ho).

### `creditWinnerPot(winnerId, pot)`
Round end pe winner ko poora pot ke coins credit karta hai (classic + zhandu dono). Safety: winner "DRAW" / null / invalid id ho to skip (draw-split alag se handle hota hai).

### `splitPotEqually(playerIds, pot)`
ZHANDU DRAW (PDF Section 8): pot ko diye gaye players me EQUALLY baanta hai. Odd pot ka bacha hua 1-1 coin shuru ke players ko de deta hai → total exact rahe (koi coin gum/inflate na ho). Show aur All-In Show dono ke draw me kaam aata hai.

---

## Match lifecycle

### `startMatch(io, matchData)` — exported
Match ko start karta hai: players ko seat se sort, boot amount economy me deduct, cards distribute (game variant ke hisaab se `cardsPerPlayer`), joker/zhandu jokers set, `playersData` build, match cache seed, aur 5s baad `dealCards` flow schedule. `joker` variant me 1 joker card, `zhandu` me 3 progressive joker cards (pehla khula) cut hote hain.

### `sendBetTurnEmit(io, currentPlayerTurnId, matchData)` — module-private
Current player ko `betTurn` emit karta hai (players + watchers dono ko), side-show enable flag compute karta hai, aur 30s turn timer ke liye BullMQ auto-pack job schedule karta hai (cluster-safe + crash-safe).

### `resolveShowdown(io, matchData)` — module-private
**ALL-IN / SHOWDOWN (Phase 5):** hand khatam → side pots banao, har pot ka winner (per-player jokers se) nikaalo, credit karo, `pots[]` save, match end, agla round. Ye fold-win (1 contender) AUR all-in showdown (multi contender) dono handle karta — `buildSidePots` 1-eligible pot bhi bana deta (uncontested → us player ko wapas/jeet). Arrow function isliye `this` = `module.exports` (`sendCommonEmitForWatcher`/`startNextRound` reach karne ke liye).

---

## Betting

### `placeBetCore(io, user, socketId, data, matchIdHint = null)` — module-private
placeBet ka asli kaam (CORE) — yeh khud LOCK **nahi** leta. Ise sirf wahi call kare jisne pehle se isi match ka lock le rakha ho:
- public `placeBet` (wrapper) lock leke ise call karta hai
- `respondToSideShow` (reject branch) bhi pehle se lock leke ise call karta hai

Isse "ek hi match ka lock do baar maangna" wala DEADLOCK nahi hota. Fold, call, raise, aur ZHANDU all-in (side-pot aware) routing yahin handle hota hai; ZHANDU me joker progressive open bhi yahin trigger hota hai.

### `placeBet(io, user, socketId, data)` — exported
Public placeBet — match ka LOCK leta hai, phir `placeBetCore` chalata hai, aur (success/error/return — kuch bhi ho) `finally` me taala HAMESHA chhodta hai. Lock na mile to double-processing se bachne ke liye "Please retry." return karta hai.

### `seenCard(io, user, socketId, data)` — exported
Player ke cards ko "seen" mark karta hai (`playersData.$.isSeen = true`), cache invalidate karta hai, aur usko uske cards emit karta hai. ZHANDU me abhi khule jokers se banne wale BEST hand ke resolved cards (`bestHand`) bhi bhejta hai. LOCK leta hai taaki "seen ke saath bet" wali race na ho (dono serialize).

---

### `fetchBestHand(io, user, socketId, data = {})` — exported
ZHANDU: client on-demand apna **current best hand** maang sakta hai. Zaroorat isliye ki joker progressive khulte hain (J1→J2→J3), to same cards ka best hand round ke beech badal jaata hai — `seenCardSuccess` sirf ek baar jaata hai. Request aur response dono ka event name **same** (`fetchBestHand`).

Player ka sabse naya chal raha zhandu match (`gameType: zhandu, start: true, end: false`, `sort createdAt:-1`) → uske `playersData` se cards → `getApplicableJokerValues` (all-in ho to freeze kiye hue jokers hi) → `evaluateBestHandWithJoker`. Response me `bestHand` (resolved cards), `handName`/`handRank`, `appliedJokerCount` (is player pe kitne joker lag rahe), `openedJokerCount`, `isAllIn`, `movesRound`.

Guards: match na mile → error; player `exitPlayers` me ho → error; cards distribute na hue ho → error; `isSeen` false ho → error (blind banda apne cards peek na kar le).

**LOCK nahi leta** — poora handler read-only hai, koi DB write nahi. Cache (`getMatch`) se bhi nahi padhta — wo sirf `placeBetCore` ka hot path hai.

---

## Side show

### `sideShow(io, user, socketId, data = {})` — exported
Side show / final show handle karta hai. 2 active players bache to FINAL SHOW (compare → winner/draw), warna SIDE SHOW request bheji jaati hai. ZHANDU Section 6: side show tabhi allowed jab teeno joker khul chuke ho AUR requester ne kam se kam 1 seen move kiya ho. ZHANDU Section 7: 2-player show pe button-side requester ho to agla band joker khulta hai. DRAW handling: classic me requester haarta, zhandu me pot split. LOCK leta hai.

### `respondToSideShow(io, user, socketId, data = {})` — exported
Side show ke response (accept/reject) ko handle karta hai.
- **accept:** dono ke cards compare, looser pack (DRAW pe requester pack — PDF Section 8), turn aage, next betTurn schedule.
- **reject:** requester ko bet continue karne ke liye `placeBetCore` (locked placeBet nahi, warna same match ka taala dobara maangne se DEADLOCK).

LOCK leta hai; `placeBetCore` ko already-held lock ke saath call karta hai.

### `startNextRound(io, matchData)` — exported
Round khatam hone ke baad agla match doc create karta hai (roomId, gameType, variation, bootAmount, previousWinner ke saath). Exit players ko filter karta hai.

**Affordability filter:** agle round me seat sirf usko milti hai jiske paas **boot ka dugna** coins ho — wahi rule jo `joinRoomNew` naye player pe lagata hai. Coins **DB se fresh** padhe jaate hain, `matchData.players` ka populated snapshot round-end ke pot credit se purana hota hai. Jinke paas itne coins nahi wo `watchers` me chale jaate hain (purane watchers ke saath merge, dedupe hoke), aur unka `seatPosition` claim bhi hat jaata hai warna wo seat index kisi aur ko mil hi nahi paata. Har aise nikale gaye player ka **`selfExitSuccess` emit** bhi jaata hai (sab players + watchers ko) taaki client seat turant khali kar de — index **purane** match se, kyunki naye match me uski seat hai hi nahi.

---

## BullMQ flow-job handlers

Ye pehle in-process `setTimeout` the → process restart/reload pe match atak jaata tha. Ab BullMQ delayed jobs se chalte hain → koi bhi worker uthaake match aage badha deta hai.

### `_flowBetTurn(io, matchId, playerTurnId)` — exported
Next player ka betTurn (2s/20s delay ke baad). Match fresh load → turn validate → `sendBetTurnEmit` (jo 30s auto-pack bhi schedule karta hai). Turn aage badh gaya to skip (double betTurn na ho).

### `_flowDealCards(io, matchId)` — exported
Match start ke 5s baad: cards emit (players + watchers) + 20s baad pehla betTurn schedule. ZHANDU me J1 ka `jokerOpened` emit betTurn se 2s pehle schedule hota hai.

### `emitJokerOpened(io, match, joker)` — exported
ZHANDU: joker khulne par sab players + watchers ko `jokerOpened` emit — COMMON helper. (3 jagah use: J1 firstJoker, J2/J3 placeBet, §7 show. DRY ke liye ek jagah.)

### `_flowFirstJoker(io, matchId)` — exported
ZHANDU: pehla betTurn shuru hone se 2s PEHLE J1 (first joker) ka `jokerOpened` emit. J1 match-start se hi khula (`opened:true`) hota; ye emit sirf client ko turn se pehle "joker khula" dikhane/animate karne ke liye hai.

### `_flowStartNext(io, matchId)` — exported
Round khatam ke 5s baad: agla match shuru (agar `minPlayer` enough hain). `waitForNextRount` false karta hai.

---

## Resync / exit

### `resyncMatch(io, user, socketId, data = {})` — exported
Reconnect ke baad client current match state maang sakta hai (`resyncMatch` event). Reload/disconnect ke beech jo emits miss hue, isse board turant sahi ho jaata hai. Sirf IS user ke apne cards bhejta hai (baaki private, seen hone par hi). ZHANDU me 3 jokers (kaun khula/band) + `movesRound` bhi bhejta hai.

### `selfExit(io, user, socketId, disconnect = false)` — exported
Self exit / disconnect: user ka `socketId` null karta hai aur `disconnect` par current time stamp karta hai. `socketId` filter jaan bujh ke hai — purane socket ka late disconnect naye connection ko na maare. Live match me ho to `exitPlayers` me daalta hai, na-shuru hue match se seat/player nikal deta hai. Aakhir me 5 min ka `closeSession` BullMQ job schedule karta hai.

**`selfExitSuccess` emit:** match me tha to sab players + watchers ko jaata hai (seat index ke saath). Match me nahi tha (lobby se nikla) **aur `disconnect` false ho** to **sirf usi ko** jaata hai `{ _id: null, roomId: null, index: -1 }` ke saath — client screen band kar sake. `disconnect` par ye emit skip hota hai kyunki socket already ja chuka hota hai.

### `_flowCloseSession(userId)` — exported (BullMQ flow handler)
`closeSession` job ka handler — disconnect ke 5 min baad chalta hai. Banda beech me wapas aa gaya to auth `disconnect: null` kar chuka hota hai → job no-op. Warna `sessionClosed: true` set karke us session ka pura record `gameSession` collection me archive karta hai — `_id` wahi user ka rakha jaata hai, isliye ek session ka ek hi doc banega (job dobara fire ho to overwrite, duplicate nahi). `disconnect: { $lte: cutoff }` isliye — purana job abhi-abhi disconnect hue bande ka session band na kar de. Live-match check abhi commented hai.

---

## Lobby / room listing

### `roomList(io, user, socketId, data = {})` — exported
Active (non-ended) matches ki list — har room ke `totalActivePlayers` (players − exitPlayers), roomId, start, end ke saath aggregate karke `fetchRoomList` emit karta hai.

### `fetchLobbyList(io, user, socketId, data = {})` — exported
`gameType` ke hisaab se lobby list. `gameType` na ho to poori `roomList` (constant) bhejta hai; invalid gameType par error; warna us gameType ke matches ka aggregate (activePlayers, watchers, entryCoins, roomName, variation, bootAmount) `fetchLobbyList` emit karta hai. `selfCoin` dono emits me jaata hai aur **DB se fresh padha jaata hai** (`socket.user` handshake-time snapshot hai, uske coins stale hote hain).

### Round-gap constant — `NEXT_ROUND_MS` (file ke top pe)
Round end se agla round start hone tak ka gap (abhi 10s). `startNextRound` isi se `startNext` BullMQ job schedule karta hai, aur teeno round-end paths ka `roundWinner` payload isi ka second-value `nextRoundIn` bhejta hai — client apna hardcoded countdown na chalaye. Value badalni ho to sirf yahi constant badlo.

### `watchRoom(io, user, socketId, data = {})` — exported
User ko room ka watcher banata hai (`$addToSet: watchers`), cache invalidate, aur match ka current state (`turn`, players+index, roomId) `watchRoom` emit karta hai.

---

## Join / common emits

### `joinRoomNew(io, user, socketId, data = {})` — exported
Player ko room ke di gayi seat (`index`) par join karata hai (atomic — seat already occupied ya player already joined ho to fail). Join success emit (players + watchers), cache invalidate. `minPlayer` pura ho aur wait na ho to `startMatch` call karta hai.

### `sendCommonEmit(io, matchData, emit)` — exported
Sab players ko diya gaya event emit karta hai — har player ke saath uska seat `index` aur `selfId` inject karke.

### `sendCommonEmitForWatcher(io, matchData, emit, data = {})` — exported
Sab watchers ko diya gaya event emit karta hai — players ke seat index ke saath. Watchers na ho to no-op.
