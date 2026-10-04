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

### `pickWinnerRank(winnersCards, winnerId)`
`roundWinner` payload ka top-level `winnerRank` nikaalta hai — main winner ke hand ka naam (`"Trail"`, `"Pure Sequence"`, `"Sequence"`, `"Color"`, `"Pair"`, `"High Card"`). Draw (zhandu split) me `winnerId` null hota hai, par dono hand barabar hote hain → pehle winner ka rank hi return hota hai. Har `roundWinner` emit (showdown, fold-win, final show — players + watchers) me `winnerRank` jaata hai.

### `buildWinnersCards(matchData, winnerIds = [])`
Har entry me `rank` bhi hota hai (hand ka naam, `getHandRankName` se — `utils.js`). Jokers per-player lagte hain (`getApplicableJokerValues`), to zhandu all-in wale ka rank unhi freeze hue jokers se banta hai jinse wo jeeta.

Diye gaye winner ids ke liye `[{ playerId, index, name, cards, rank }]` banata hai (ids dedupe hote hain — multi-pot me ek hi player kai pot jeet sakta hai). Isse **teeno round-end paths** ka `roundWinner` payload ek jaisa rehta hai: har emit me ab `winnerCards` (main winner ke cards, draw pe `null`) aur `winnersCards` (sab winners ka detail) jaata hai. Pehle winner ke cards har branch me alag shape me aate the — showdown me `reveal` map, fold-win me `player1`, show me `player1`/`player2` — to client ko teen jagah dekhni padti thi.

---

## ZHANDU helpers

### `isRoundComplete(matchData, justActedId)`
**COMMON — sab variants.** Betting ka ek chakkar poora hua ya nahi (seat-order ka aakhri bettor khel chuka). Isi se match ka `round` key `$inc` hota hai. Zhandu ke `isZhanduRoundComplete` se JAANBOOJH KE alag function hai — zhandu wala joker kholne ke liye hai aur use chheda nahi gaya.
- `round` 1 se shuru hota hai (`startMatch` set karta hai) = abhi kaunsa chakkar chal raha hai.
- Ye `placeBetCore` me badhta hai (chaal / pack / all-in / autopack / side show reject + timeout sab isi se guzarte hain) aur `respondToSideShow` ke **accept** branch me bhi — wahan requester ka turn `placeBetCore` ke bina khatam hota hai.
- `round` aur `movesRound` alag hain: `movesRound` joker ka index hai (2 pe ruk jaata), `round` seedhi ginti hai.

### `isZhanduRoundComplete(matchData, justActedId)`
PDF Section 2: "round of moves" complete hua ya nahi (button store kiye bina). Tareeka: abhi ke ACTIVE (`isPacked=false`) players ko seat-index se sort karo. Jo abhi khela (`justActedId`) agar is list ka AAKHRI player tha → ek round poora ho gaya.
- `justActedId` ko khud bhi gino chahe usne abhi FOLD kiya ho (PDF: "makes a move OR Folds") → isiliye filter me usko OR se include karte hain.
- Fold hone par "last active" naturally agle player par shift ho jaata → PDF ka "button fold ho chuka to right-of-button tak" wala case bhi isi se cover ho jaata.
- All-in player bet nahi karta → use bhi skip karo (par abhi jisne act kiya usko include karo, chahe wo fold/all-in ho).

### `takeCommission(pot)` — module-private
Pure math: `Math.floor(pot × COMMISSION_PERCENT / 100)` (`.env` ka `COMMISSION_PERCENT`, na ho to 5) wapas deta hai — DB ko haath nahi lagata (pehle ye khud `$inc` karta tha, ab wo `recordPayout` me hai). Floor ki wajah se chhote pot (< 20) pe commission 0. Commission ka rule badalna ho to sirf yahin.

### `recordPayout(matchId, entries, commission)` — module-private
Match pe commission `$inc` + winners ka breakdown `payouts[]` me `$push` — **EK updateOne me**. `entries` = `[{ playerId, amount, commission, potNo }]`. House ledger (`helper/houseLedger.helper.js → saveHouseLedger`) isi `payouts[]` se banta hai, isliye credit aur record kabhi alag nahi hote. `$push` isliye ki side pots me ek match pe kai baar credit hota hai.

### `creditWinnerPot(winnerId, pot, matchId, potNo = null)`
Round end pe winner ko pot ke coins credit karta hai (classic + zhandu dono) — **commission kaat ke**. User `$inc` aur `recordPayout` `Promise.all` me saath. Safety: winner "DRAW" / null / invalid id ho to skip (draw-split alag se handle hota hai) — us soorat me commission bhi nahi katta, payout bhi nahi.

### `splitPotEqually(playerIds, pot, matchId, potNo = null)`
ZHANDU DRAW (PDF Section 8) + all-in side pots: pot ko diye gaye players me EQUALLY baanta hai — pehle poore pot se commission katta hai, phir bacha hua baant-ta hai. Odd pot ka bacha hua 1-1 coin shuru ke players ko de deta hai → total exact rahe (koi coin gum/inflate na ho). **Commission bhi usi tarah (equal + remainder) winners pe record hota hai**, taaki `payouts[]` me sum(amount) + sum(commission) == pot exact ho. `resolveShowdown` har pot ka `potNo` pass karta hai.

---

## Match lifecycle

### `startMatch(io, matchData)` — exported
Match ko start karta hai: players ko seat se sort, boot amount economy me deduct, cards distribute (game variant ke hisaab se `cardsPerPlayer`), joker/zhandu jokers set, `playersData` build, match cache seed, aur 5s baad `dealCards` flow schedule. `joker` variant me 1 joker card, `zhandu` me 3 progressive joker cards (pehla khula) cut hote hain.

### `sendBetTurnEmit(io, currentPlayerTurnId, matchData)` — module-private
Current player ko `betTurn` emit karta hai (players + watchers dono ko), side-show enable flag compute karta hai, aur 30s turn timer ke liye BullMQ auto-pack job schedule karta hai (cluster-safe + crash-safe).

`showEnable` (side show button) tabhi `true` jab **teeno** shartein poori hon: (1) 2 se zyada active bettors (`!isPacked && !isAllIn`) — 2 bache to `isShow` (final show) hai, side show nahi; (2) saare active bettors seen ho chuke hon; (3) itne betting chakkar poore ho chuke hon — classic variants (teenpatti/muflis/joker/fourcard/twocard) me 3, zhandu/flipper me 5. Chakkar `match.round` se ginte hain (1 se shuru, har poore round pe ++), to "3 ke baad" = `round > 3`. Purani zhandu (teeno joker khule) / flipper (seenMoves) wali shartein hata di gayi hain.

### `resolveShowdown(io, matchData)` — module-private
**ALL-IN / SHOWDOWN (Phase 5):** hand khatam → side pots banao, har pot ka winner (per-player jokers se) nikaalo, credit karo, `pots[]` save, match end, agla round. Ye fold-win (1 contender) AUR all-in showdown (multi contender) dono handle karta — `buildSidePots` 1-eligible pot bhi bana deta (uncontested → us player ko wapas/jeet). Arrow function isliye `this` = `module.exports` (`sendCommonEmitForWatcher`/`startNextRound` reach karne ke liye). `roundWinner` payload me `reveal` (sab non-folded ke cards) ke saath `winnerCards`/`winnersCards` (`buildWinnersCards` se — har pot ka winner) bhi jaata hai.

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
Side show / final show handle karta hai. 2 active players bache to FINAL SHOW (compare → winner/draw), warna SIDE SHOW request bheji jaati hai.

**SHOW / SIDE SHOW ka CHAAL request ke waqt hi katta hai — `if (show)` branch se PEHLE, yani final show aur side show DONO me:** requester ki chaal = `currentBetAmount` × seen/previousWinner multiplier (seen x2, previousWinner x2, dono x4 — wahi jo `sendBetTurnEmit` me hai). Requester ke paas poori chaal ke coins na hon to kuch kaatne se pehle hi `errorLog` ("Show not possible. You don't have enough balance for side show.") aur return — turn wahin rehta hai, auto-pack timer chalta rehta hai (pot = actually debited, economy net-zero). Sirf do query: requester ke coins `$inc -requesterBet` aur match ka `pot` `$inc +requesterBet` — uske baad hi show (compare → pot credit, jisme ye chaal shamil hai) ya side show (`respondToSideShow(accept: true)`) chalta hai. Jaan-boojh ke simple rakha hai: `totalBet`/`seenMoves` nahi badhte aur alag `successPlaceBet` emit nahi jaata (pot agle emit me dikhta hai). Accept branch me ab koi charge nahi. ZHANDU Section 6: side show tabhi allowed jab teeno joker khul chuke ho AUR requester ne kam se kam 1 seen move kiya ho. ZHANDU Section 7: 2-player show pe button-side requester ho to agla band joker khulta hai. DRAW handling: classic me requester haarta, zhandu me pot split. LOCK leta hai.

Request branch ka `timer` **hardcoded nahi** hai — `getAutoPackRemainingMs(matchId)` se requester ke chal rahe 30s auto-pack ka bacha hua time bheja jaata hai (job hi asli deadline hai). Wahi bacha hua time le kar request branch **auto-pack CANCEL karke uski jagah `sideShowTimeout` job** lagata hai (`{ matchId, requesterId, responderId }`). Wajah: pehle deadline khatam hone par requester ka auto-pack fire hota tha — yani responder ki khamoshi ki saza requester ko FOLD ke roop me milti thi, jabki usne chaal lagane ke liye hi show maanga tha. Ab timeout par side show reject maan liya jaata hai aur requester ki CHAAL lag jaati hai (`_flowSideShowTimeout` dekho). Client ka timer nahi badla — dono ek hi ghadi pe chalte hain.

Requester chahe to intezaar chhod ke seedha chaal/pack kar sakta hai, tab `placeBetCore` `sideShow` flag clear kar deta hai — responder ka late jawab AUR pending `sideShowTimeout` job dono apne aap no-op ho jaate hain.

Target chunne wala `sideShowTurnManager` ab **all-in players ko skip** karta hai (packed ke saath) — all-in banda side-pot ka haqdaar hai, use side show me harakar pack karana wo haq cheen leta jabki uske paas koi betting decision bacha hi nahi tha.

**Final show pe do emit jaate hain, isi order me:** pehle `sideShowWinner` (`{ player1, player2, winnerId, looserId, isDraw, isFinalShow: true }` — players + watchers dono ko), phir `roundWinner`. Wajah: final show bhi 1v1 card-compare hi hai, to client wahi face-to-face reveal animation chala sake jo side show me chalti hai; pehle sirf `roundWinner` jaata tha aur compare dikhta hi nahi tha. Beech me delay JAAN-BOOJH KE nahi hai — `roundWinner` ka `nextRoundIn` countdown `startNext` job ke saath sync rehna chahiye, sequencing client karta hai. ZHANDU draw (`splitAmong`) me `looserId: null` jaata hai. (Multi-player all-in showdown `resolveShowdown` se jaata hai — wahan sirf `roundWinner`, kyunki wo 1v1 hai hi nahi.)

Isi tarah `totalActivePlayers` (jo `show` vs `side show` decide karta hai) ab sirf **BETTORS** hain — `!isPacked && !isAllIn`. Iske saath ek guard bhi hai: agar contenders (`!isPacked`) bettors se ZYADA hain (matlab koi all-in contender maujood hai) to final-show branch ka seedha 2-way `compareResult` + `creditWinnerPot(pura pot)` **nahi** chalta, balki `resolveShowdown` chalta hai — warna all-in player comparison se hi ud jaata aur uska pot me laga paisa doosre ko chala jaata. Isi wajah se match query me `watchers` bhi populate hota hai (warna `sendCommonEmitForWatcher` ko sirf ObjectId milte aur spectators ko showdown/roundWinner dikhta hi nahi).

### `finishSideShow(io, matchData, requesterId, responderId)` — module-private
Side show ka ANT — **reject** aur **timeout**, dono ka natija bilkul ek hai, isliye ek hi jagah:
sab players ko `rejectSideShow` emit (`from = responder, to = requester`), phir requester ki
minimum chaal (seen / previousWinner ka ×2 / ×4 multiplier) `placeBetCore` se.

**SAFETY:** requester ke paas itne coins hi na bache to `placeBetCore` "Insufficient coins" pe
return kar deta, aur auto-pack request ke waqt cancel ho chuka hota hai → turn hamesha ke liye
freeze. Isliye non-zhandu me coins kam ho to `isPacked: true` (purana wala hi natija). Zhandu me
kam coins = ALL-IN, jo `placeBetCore` khud sambhalta hai → wahan pack nahi.

**LOCK NAHI leta** — `placeBetCore` jaisa hi, bulane wale ka taala maanta hai:
- `respondToSideShow` (reject branch) → taala pehle se hai → seedha call
- `_flowSideShowTimeout` → pehle khud taala leta hai → phir call

Pehle ye poora code DO jagah copy tha; ek jagah multiplier badalta aur doosri chhoot jaati, isliye
nikaal ke ek kar diya.

### `respondToSideShow(io, user, socketId, data = {})` — exported
Side show ke response (accept/reject) ko handle karta hai.
- **accept:** dono ke cards compare, looser pack (DRAW pe requester pack — PDF Section 8), turn aage, next betTurn schedule. Requester ka chaal **yahan charge NAHI hota** — wo `sideShow()` me request ke waqt hi kat chuka hai (neeche dekho); yahan dobara kaata to double charge. (Pehle accept branch me flat `currentBetAmount` katta tha, seen/blind ka farq nahi tha.)
- **reject:** poora kaam `finishSideShow(io, matchData, otherPlayerId, userId)` karta hai (`otherPlayerId` = `matchData.turn` = requester, `userId` = jisne reject kiya). Taala yahan pehle se held hai aur helper khud taala nahi leta — isliye seedha call, deadlock nahi.

LOCK leta hai; `placeBetCore` ko already-held lock ke saath call karta hai.

### `allInSideShow(io, matchData, allInPlayerId)` — exported (FLIPPER §4)
Flipper me all-in move apne aap **left-hand player ke saath forced side show** ban jaata hai. Upar wale asli side show se **jaanboojh ke alag** rakha gaya hai — koi request/accept/reject nahi, koi 10s timer nahi; server khud compare karta hai. `placeBetCore` ka flipper all-in tail ise call karta hai (`isFlipper && isAllInMove`), normal `betTurn` ki jagah.

- **Target:** `playersData` me se sirf packed hataake circular **PREVIOUS** player — wahi definition jo `sideShowTurnManager` ki hai, taaki table pe do alag concept na banein. All-in players target ban sakte hain (pot ke daavedar wo bhi hain), khud all-in wala list me rehta hai warna target hi na mile.
- **Forced seen (D6):** dono pe `isSeen = true`, par `seenMoves` **nahi** badhta — wo §3 ki side-show eligibility control karta hai, aur cards dekh lene se chaal khelne ka haq nahi mil jaata.
- **DRAW (D1):** all-in wala haarta — codebase ka purana side-show tie rule (jisne maanga wo haara) aur chain ka pakka terminator.
- **Looser:** `isPacked = true` (D5 — naya flag nahi, poora system isi pe key karta hai), aur §2 ke hisaab se uski cards se `replaceVariableJokers` → naya board, `jokerOpened` emit.
- **Emit:** `sideShowWinner` — cards sirf un dono ko (`player1`/`player2`), baaki table + watchers ko sirf natija. Payload me `isForced: true, reason: "allInSideShow"`.
- **Aage:** 1 hi bacha → `resolveShowdown` (side pots ke saath pot baant). Warna `FLIPPER_CHAIN_MS` (3s, D3) baad agla `betTurn`. Turn `placeBetCore` pehle set kar chuka hota hai; wahi banda show me pack ho gaya to `nextBettorFrom` se agla nikalta hai.

**LOCK nahi leta** — `placeBetCore` ke andar se chalta hai jo pehle se match lock leke baitha hai (dobara lene pe apne aap se deadlock). `placeBetCore` wali hi discipline.

**PENDING:** chain (left wala haara → all-in ka hand agle left player se phir forced show) abhi nahi hai — code me `TODO (agla step — chain)` marker hai. `FLIPPER_PLAN.md` Phase 4 dekho.

### `nextBettorFrom(playersData, fromPlayerId)` — module-private
Poori seat-order list pe aage chal ke pehla non-packed, non-all-in player deta hai. `turnManager` yahan kaam nahi karta kyunki wo reference player ko bhi **filtered** list me dhoondta hai — haara hua banda tab tak pack ho chuka hota hai to `null` milta.

### `startNextRound(io, matchData)` — exported
Round khatam hone ke baad agla match doc create karta hai (roomId, gameType, variation, bootAmount, vMode, previousWinner ke saath). Exit players ko filter karta hai.

**History copy + house ledger + delete (sabse last):** naya match ban ke `startNext` job schedule hone ke baad, end ho chuke match ka **ditto copy** `matchHistory` table me jaata hai (`model/matchHistory.model.js` — match schema ka `clone()`, same `_id`), `saveHouseLedger(endedMatch)` se `houseLedger` entry banti hai (pot, commission = house profit, winners[] with amount/commission — sab `payouts[]` se), aur wo doc `match` table se `deleteOne` hota hai — teeno `Promise.all` me. Doc Mongo se fresh `.lean()` uthta hai kyunki `matchData` populated snapshot hota hai. Apna alag try/catch hai — fail ho to bhi agla round nahi rukta.

**Session filter:** coins wali DB query `sessionClosed: false` pe hai — jiska session close ho chuka (3 min disconnect ke baad `closeSession` job) wo agle round me **bilkul nahi aata**: na player, na watcher. Pehle aisa player coins=0 count hoke galti se watcher ban jaata tha; ab `closedPlayers` alag nikaal ke pura exclude hota hai, aur uska bhi `selfExitSuccess` emit jaata hai.

**Affordability filter:** agle round me seat sirf usko milti hai jiske paas **boot ka dugna** coins ho — wahi rule jo `joinRoomNew` naye player pe lagata hai. Coins **DB se fresh** padhe jaate hain, `matchData.players` ka populated snapshot round-end ke pot credit se purana hota hai. Jinke paas itne coins nahi wo `watchers` me chale jaate hain (purane watchers ke saath merge, dedupe hoke), aur unka `seatPosition` claim bhi hat jaata hai warna wo seat index kisi aur ko mil hi nahi paata. Har aise nikale gaye player ka **`selfExitSuccess` emit** bhi jaata hai (sab players + watchers ko) taaki client seat turant khali kar de — index **purane** match se, kyunki naye match me uski seat hai hi nahi.

---

## BullMQ flow-job handlers

Ye pehle in-process `setTimeout` the → process restart/reload pe match atak jaata tha. Ab BullMQ delayed jobs se chalte hain → koi bhi worker uthaake match aage badha deta hai.

### `_flowBetTurn(io, matchId, playerTurnId)` — exported
Next player ka betTurn (2s/20s delay ke baad). Match fresh load → turn validate → `sendBetTurnEmit` (jo 30s auto-pack bhi schedule karta hai). Turn aage badh gaya to skip (double betTurn na ho).

### `_flowDealCards(io, matchId)` — exported
Match start ke 5s baad: cards emit (players + watchers), phir match pe `cardDistributed: true` set (findOneAndUpdate, filter me `cardDistributed: false` taaki duplicate job fire pe dobara write na ho; baad me `setMatch` se cache refresh) + 20s baad pehla betTurn schedule. ZHANDU me J1 ka `jokerOpened` emit betTurn se 2s pehle schedule hota hai; FLIPPER me wahi `firstJoker` job chaaron joker ka reveal bhejta hai.

### `emitJokerOpened(io, match, joker, extra = {})` — exported
Joker board badalne par sab players + watchers ko `jokerOpened` emit — COMMON helper.
- ZHANDU (3 jagah): J1 firstJoker, J2/J3 placeBet, §7 show. `joker` = jo EK joker abhi khula.
- FLIPPER (3 jagah): start pe chaaron reveal, placeBet ka fold, side-show looser ka fold. Wahan
  ek saath poora board badalta hai isliye `extra` me `{ jokers: [...4], reason: "open"|"flip", foldedBy }`
  jaata hai (`joker` field backward-compat ke liye pehla element rakhta hai).

### `_flowFirstJoker(io, matchId)` — exported
Pehla betTurn shuru hone se 2s PEHLE joker reveal emit. Jokers DB me pehle se hi `opened:true` hote;
ye emit sirf client ko turn se pehle board dikhane/animate karne ke liye hai.
- ZHANDU: sirf J1.
- FLIPPER: chaaron joker ek saath (`reason: "open"`) — PDF §1 ke hisaab se sab boot ke turant baad khulte hain.

### `_flowStartNext(io, matchId)` — exported
Round khatam ke 5s baad: agla match shuru (agar `minPlayer` enough hain). `waitForNextRount` false karta hai.

### `_flowSideShowTimeout(io, matchId, requesterId, responderId)` — exported
`sideShowTimeout` job ka handler — side show ka jawab bache hue time me nahi aaya. Guard ek hi atomic `findOneAndUpdate` hai: `{ start:true, end:false, sideShow:true, sideShowUser: responderId, turn: requesterId }` → `{ sideShow:false, sideShowUser:null }`. Filter fail = koi na koi (responder ka accept/reject, ya requester ki apni chaal/pack) pehle act kar chuka → job LATE, chupchaap return. Isiliye job ko track/cancel karne ki zaroorat nahi (baaki flow jobs jaisa validate-on-fire).

Guard pass hone ke baad: cache invalidate, phir `finishSideShow(io, matchData, requesterId, responderId)` — wahi helper jo reject branch chalata hai (emit + chaal + insufficient-coins safety, sab wahan hai). LOCK yahan khud liya jaata hai, kyunki helper aur `placeBetCore` dono bina taale ke chalte hain.

---

## Resync / exit

### `resyncMatch(io, user, socketId, data = {})` — exported
Reconnect ke baad client current match state maang sakta hai (`resyncMatch` event). Reload/disconnect ke beech jo emits miss hue, isse board turant sahi ho jaata hai. Sirf IS user ke apne cards bhejta hai (baaki private, seen hone par hi). ZHANDU me 3 jokers (kaun khula/band) + `movesRound` bhi bhejta hai.

**`timer`:** jiski chaal hai uske turn me jitne second bache hain (`getAutoPackRemainingMs` — auto-pack job se, wahi authority hai). Pehle hamesha `10` jaata tha. Auto-pack job na ho (do turn ke beech ka ~2s gap, side show pending, round khatam) to `0`.

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
`gameType` ke hisaab se lobby list. `gameType` na ho to poori `roomList` (constant) **do events pe** bhejta hai — `gameList` AUR `fetchLobbyList` dono (jslib sirf SIO_On se registered events Unity tak forward karta hai; client `gameList` sunta hai ya nahi confirm nahi tha, isliye dono pe). Invalid gameType par error; warna us gameType ke matches ka aggregate (activePlayers, watchers, entryCoins, roomName, variation, bootAmount) `fetchLobbyList` emit karta hai. `selfCoin` sab emits me jaata hai aur **DB se fresh padha jaata hai** (`socket.user` handshake-time snapshot hai, uske coins stale hote hain).

### Round-gap constant — `NEXT_ROUND_MS` (file ke top pe)
Round end se agla round start hone tak ka gap (abhi 10s). `startNextRound` isi se `startNext` BullMQ job schedule karta hai, aur teeno round-end paths ka `roundWinner` payload isi ka second-value `nextRoundIn` bhejta hai — client apna hardcoded countdown na chalaye. Value badalni ho to sirf yahi constant badlo.

### `watchRoom(io, user, socketId, data = {})` — exported
User ko room ka watcher banata hai (`$addToSet: watchers`), cache invalidate, aur match ka current state (`turn`, players+index, roomId) `watchRoom` emit karta hai. `timer` = chal rahe turn ke bache hue second (`getAutoPackRemainingMs`, `resyncMatch` jaisa hi) — pehle hamesha `10` tha; auto-pack job na ho to `0`.

---

## Join / common emits

### `joinRoomNew(io, user, socketId, data = {})` — exported
Player ko room ke di gayi seat (`index`) par join karata hai (atomic — seat already occupied ya player already joined ho to fail). Join success emit (players + watchers), cache invalidate, phir `broadcastLobbyUpdate` (sab clients ko `updateLobbyList`). `minPlayer` pura ho aur wait na ho to `startMatch` call karta hai.

### `broadcastLobbyUpdate(io, matchData)` — exported
Sab connected clients ko (global `io.emit`, cluster-wide) `updateLobbyList` emit karta hai, data me sirf `{ gameType }` — lobby wale client us tab ki list dubara `fetchLobbyList` se maang lete hain. `vMode` room ho to `gameType: "variation"` jaata hai (lobby ka variation tab `vMode` se filter hota hai), warna match ka apna `gameType`.

### `sendCommonEmit(io, matchData, emit)` — exported
Sab players ko diya gaya event emit karta hai — har player ke saath uska seat `index` aur `selfId` inject karke.

### `sendCommonEmitForWatcher(io, matchData, emit, data = {})` — exported
Sab watchers ko diya gaya event emit karta hai — players ke seat index ke saath. Watchers na ho to no-op.
