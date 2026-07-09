// Dependencies

const { socketEmit, gameConfig, gameTypeConfig, zhanduConfig } = require("../../helper/appConstant");
const mongoose = require("mongoose");
const roomSchema = require("../../model/room.model");
const userSchema = require("../../model/user.model");
const matchSchema = require("../../model/match.model");
const economySchema = require("../../model/economy.mode.")
const cardDeck = require("../../helper/card.json");
const { turnManager, sideShowTurnManager, compareResult, parseMongoObjectId, checkIndex, getOpenedJokerValues, getApplicableJokerValues, buildSidePots, pickPotWinners, evaluateBestHandWithJoker } = require("../../helper/utils");
const { acquireLock, releaseLock } = require("../../helper/lock.helper");
const { emitToUser } = require("../../helper/emit.helper");
const { scheduleAutoPack, cancelAutoPack, scheduleFlow } = require("../../helper/turnTimer.helper");
const { getMatch, setMatch, deleteMatch } = require("../../helper/matchState.helper");
const moment = require('moment')

// global variables
global.roomTimeouts = {};
global.dashCallTimeouts = {};
// global.turnTimers hata diya — turn auto-pack timer ab BullMQ (Redis) me hai
// (helper/turnTimer.helper.js), process-memory me nahi -> cluster-safe.


function shuffle(deck) {
    const copy = [...deck];
    for (let i = copy.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

const sortPlayerAccSeat = (matchData) => {

    try {

        let data = matchData.players.map(player => {
            return {
                ...player,
                index: checkIndex(matchData, player?._id)
            };
        });

        data = data.filter(x => x.index >= 0)

        data.sort((a, b) => a.index - b.index); // ascending order

        return data;
    } catch (error) {
        throw new Error(error)
    }
};


// ===== ZHANDU helpers ======================================================

// PDF Section 2: "round of moves" complete hua ya nahi (simple, button store kiye bina).
// Tareeka: abhi ke ACTIVE (isPacked=false) players ko seat-index se sort karo. Jo abhi
// khela (justActedId) agar is list ka AAKHRI player tha -> ek round poora ho gaya.
//   - justActedId ko khud bhi gino chahe usne abhi FOLD kiya ho (PDF: "makes a move
//     OR Folds") -> isiliye filter me usko OR se include karte hain.
//   - fold hone par "last active" naturally agle player par shift ho jaata -> PDF ka
//     "button fold ho chuka to right-of-button tak" wala case bhi isi se cover ho jaata.
const isZhanduRoundComplete = (matchData, justActedId) => {
    // Round bettors ke turns se complete hota. All-in player bet nahi karta -> use bhi
    // skip karo (par abhi jisne act kiya usko include karo, chahe wo fold/all-in ho).
    const active = (matchData?.playersData || [])
        .filter(x => (!x?.isPacked && !x?.isAllIn) || String(x?.playerId) === String(justActedId))
        .sort((a, b) => checkIndex(matchData, a?.playerId) - checkIndex(matchData, b?.playerId));

    const last = active[active.length - 1];
    return last && String(last?.playerId) === String(justActedId);
};

// Round end pe winner ko poora pot ke coins credit karo (classic + zhandu dono).
// Safety: winner "DRAW" / null / invalid id ho to skip (draw-split alag se handle hoga).
const creditWinnerPot = async (winnerId, pot) => {
    if (!winnerId || String(winnerId) === "DRAW" || !mongoose.Types.ObjectId.isValid(winnerId)) return;
    if (!pot || pot <= 0) return;
    await userSchema.model.updateOne({ _id: winnerId }, { $inc: { coins: pot } });
};

// ZHANDU DRAW (PDF Section 8): pot ko diye gaye players me EQUALLY baanto.
// Odd pot ka bacha hua 1-1 coin shuru ke players ko de dete hain -> total exact rahe
// (koi coin gum/inflate na ho). Show aur All-In Show dono ke draw me kaam aata hai.
const splitPotEqually = async (playerIds, pot) => {
    const ids = (playerIds || []).filter(id => id && mongoose.Types.ObjectId.isValid(id));
    if (!ids.length || !pot || pot <= 0) return;
    const share = Math.floor(pot / ids.length);
    let remainder = pot - share * ids.length;
    for (const id of ids) {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        await userSchema.model.updateOne({ _id: id }, { $inc: { coins: share + extra } });
    }
};

module.exports.startMatch = async (io, matchData) => {

    try {
        let startMatch = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, start: false }, { start: true }, { new: true }).populate('players', 'name socketId coins').populate('watchers', '_id name socketId coins').lean()
        if (!startMatch) return;

        let sortPlayer = sortPlayerAccSeat(startMatch)
        const updateEconomy = []
        let bootAmount = 0
        let currentBetAmount = gameConfig?.bootAmount

        sortPlayer.map((x) => {
            //  io.to(x?.socketId).emit(socketEmit.matchStart, { ...matchData })
            updateEconomy.push({ user: x?._id, matchId: startMatch?._id, betAmount: gameConfig?.bootAmount });
            bootAmount = bootAmount + gameConfig?.bootAmount
        })

        this.sendCommonEmit(io, startMatch, socketEmit.matchStart)
        this.sendCommonEmitForWatcher(io, startMatch, socketEmit.matchStart)

        //----------Update Economy-------
        await Promise.all([
            economySchema.model.insertMany(updateEconomy),
            userSchema.model.updateMany({ $expr: { $in: ["$_id", startMatch?.players?.map(x => x?._id)] } }, { $inc: { coins: - (gameConfig?.bootAmount) } })
        ])


        //Distribute Card
        const cards = shuffle(cardDeck)

        // how many cards to deal depends on the game variant (teenpatti=3, fourcard=4, ...)
        const { cardsPerPlayer } = gameTypeConfig[startMatch?.gameType] || gameTypeConfig.teenpatti

       
        let jokerCard = null
        if (startMatch?.gameType === "joker") jokerCard = cards.pop()

        let jokerCards = []
        if (startMatch?.gameType === "zhandu") {
            for (let i = 0; i < (zhanduConfig?.jokerCount || 3); i++) {
                jokerCards.push({ card: cards.pop(), opened: i === 0 })
            }
        }

        const playersData = []
        sortPlayer.map((x) => {
            if (x?._id && x?.index >= 0) playersData.push({ playerId: x?._id, cards: cards.splice(-cardsPerPlayer), turn: !playersData[0] ? true : false, index: x?.index })
        })

        const currentPlayerTurn = playersData[0]?.playerId

       
        startMatch = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, }, { playersData, pot: bootAmount, bootAmount: gameConfig?.bootAmount, turn: currentPlayerTurn, currentBetAmount, jokerCard, jokerCards, movesRound: 0 }, { new: true }).populate('players', 'name socketId coins').populate('watchers', '_id name socketId coins').lean()

        // CACHE seed: round shuru -> authoritative match cache me daal do (pehla bet cache-hit).
        await setMatch(startMatch)

        // 5s baad cards emit (uske 20s baad pehla betTurn) — dono BullMQ flow jobs.
        await scheduleFlow("dealCards", { matchId: String(startMatch?._id) }, 5000)


    } catch (error) {
        console.log("::::::::::::::::::::::::::::::::::::::start match error::::::::::", error)
        // return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });

    }
};


const sendBetTurnEmit = async (io, currentPlayerTurnId, matchData) => {


    try {

        let index = checkIndex(matchData, currentPlayerTurnId)

        const totalActivePlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];

        const otherPlayerForSideShow = sideShowTurnManager(matchData?.playersData, currentPlayerTurnId)

        showEnable = totalActivePlayers.length == 2 || otherPlayerForSideShow?.isSeen ? true : false

        matchData.players.forEach((player) => {
            emitToUser(io, player?._id, socketEmit.betTurn, { _id: matchData?._id, userId: currentPlayerTurnId, timer: 30, index, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, showEnable: showEnable });
        });

        module.exports.sendCommonEmitForWatcher(io, matchData, socketEmit.betTurn, { _id: matchData?._id, userId: currentPlayerTurnId, timer: 30, index, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, showEnable: showEnable })


        // 30s turn timer — ab BullMQ (Redis) delayed job se. Cluster-safe + crash-safe.
        // 30s tak player ne action nahi liya to worker isko auto-pack kar dega.
        await scheduleAutoPack(matchData?._id, currentPlayerTurnId);
    } catch (error) {
        throw new Error(error)
    }

}



// ALL-IN / SHOWDOWN (Phase 5): hand khatam -> side pots banao, har pot ka winner
// (per-player jokers se), credit karo, pots[] save, match end, agla round.
// Ye fold-win (1 contender) AUR all-in showdown (multi contender) dono handle karta —
// buildSidePots 1-eligible pot bhi bana deta (uncontested -> us player ko wapas/jeet).
// Arrow function isliye `this` = module.exports (sendCommonEmitForWatcher/startNextRound).
const resolveShowdown = async (io, matchData) => {
    const pots = buildSidePots(matchData?.playersData, matchData?.bootAmount)

    const potResults = []
    for (let i = 0; i < pots.length; i++) {
        const pot = pots[i]
        const entries = pot.eligible.map(id => {
            const pd = matchData.playersData.find(p => String(p?.playerId) === String(id))
            return { id, cards: pd?.cards, jokerValues: getApplicableJokerValues(matchData, pd) }
        })
        // 1 hi eligible -> uncontested (compare nahi, wahi winner). warna best-hand nikaalo.
        const res = entries.length === 1
            ? { winners: [entries[0].id], handName: null }
            : pickPotWinners(entries, matchData?.gameType)
        potResults.push({ potNo: i, amount: pot.amount, eligible: pot.eligible, winners: res.winners, hand: res.handName })
    }

    // Har pot uske winners me equally credit (splitPotEqually pot-conserving hai).
    for (const r of potResults) {
        await splitPotEqually(r.winners, r.amount)
    }

    const mainWinner = potResults[0]?.winners?.[0] || null

    // Non-folded players ke cards reveal (client showdown dikha sake).
    const reveal = {}
    matchData.playersData.forEach(pd => {
        if (!pd?.isPacked) reveal[String(pd?.playerId)] = { cards: pd?.cards, index: checkIndex(matchData, pd?.playerId) }
    })

    matchData.players.forEach(player => {
        emitToUser(io, player?._id, socketEmit.roundWinner, { _id: matchData?._id, winnerId: mainWinner, pots: potResults, reveal, isShowdown: true })
    })
    this.sendCommonEmitForWatcher(io, matchData, socketEmit.roundWinner, { _id: matchData?._id, winnerId: mainWinner, pots: potResults, reveal, isShowdown: true })

    await cancelAutoPack(matchData?._id)
    matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, end: false }, { end: true, winner: mainWinner, pots: potResults }, { new: true }).populate('players', 'name socketId coins').lean()
    await deleteMatch(matchData?._id)
    this.startNextRound(io, matchData)
}

// placeBet ka asli kaam (CORE) — yeh khud LOCK nahi leta.
// Ise sirf wahi call kare jisne pehle se isi match ka lock le rakha ho:
//   - public placeBet (neeche) lock leke ise call karta hai
//   - respondToSideShow (reject branch) bhi pehle se lock leke ise call karta hai
// Isse "ek hi match ka lock do baar maangna" wala DEADLOCK nahi hota.
const placeBetCore = async (io, user, socketId, data, matchIdHint = null) => {

    try {

        let { amount, isPacked, isRaisebet } = data;


        let userId = socketId ? user?._id : user
        const check = socketId ? { _id: user?._id, socketId } : { _id: user }

        // if turn are run automatic then we will get userId
        console.log(":::::::::::::::place BEt:::::::::", { userId, name: user?.name, check })

        // Match ka _id: caller (wrapper / respondToSideShow) ne diya to wahi; warna halki lookup.
        let matchId = matchIdHint
        if (!matchId) {
            const m = await matchSchema.model.findOne({ start: true, end: false, turn: userId }).sort({ createdAt: -1 }).select("_id").lean()
            matchId = m?._id
        }

        // READ: match Redis CACHE se (miss pe Mongo se populate + cache me daal deta hai).
        // userData hamesha FRESH Mongo se (coins authoritative rakhne ke liye).
        let [userData, matchData] = await Promise.all([
            userSchema.model.findOne({ ...check }),
            matchId ? getMatch(matchId, { populate: true }) : null
        ])



        // Cache se aaya doc -> turn ab khud validate karo (pehle query filter {turn} karta tha).
        if (!matchData || !userData || matchData.end || !matchData.start || String(matchData.turn) !== String(userId)) {
            return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Not your turn." });
        }
        // else if (amount && amount != matchData?.currentBetAmount) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Invalid bet amount." });

        let currentBet = matchData?.currentBetAmount
        isPacked = isPacked || false
        const isZhandu = matchData?.gameType === "zhandu"

        //ADD VALIDATION FOR RAISE BET
        amount = isRaisebet ? Number(currentBet) * 2 : Number(currentBet)

        // ALL-IN (sirf ZHANDU): explicit flag (data.isAllIn) ya coins required se kam pade.
        // betPut = actual paisa jo pot me jaata (all-in me = player ke bache saare coins).
        let isAllInMove = false
        let betPut = isPacked ? 0 : amount
        if (isZhandu && !isPacked && (data?.isAllIn === true || Number(userData?.coins || 0) < amount)) {
            isAllInMove = true
            betPut = Number(userData?.coins || 0)
            amount = Math.max(Number(currentBet) || 0, betPut)   // all-in > current -> raise jaisa
        }
        let updatePot = betPut

        let nextPlayerTurnId = turnManager(matchData?.playersData, userId)

        // Non-zhandu: agla turn nahi -> return (ORIGINAL behaviour, chhedo mat).
        // Zhandu: showdown tail handle karega (all-in me bettor khatam ho sakta).
        if (!isZhandu && !nextPlayerTurnId) return;

        matchData.playersData.map((x) => {
            if (String(x?.playerId) == String(userId)) {

                if (isPacked) { x.isPacked = true }
                // ===== ZHANDU: all-in aware (totalBet = actual betPut, side-pot ke liye) =====
                else if (isZhandu) {
                    x.totalBet += betPut
                    if (x?.isSeen) x.seenMoves = (x.seenMoves || 0) + 1
                    if (isAllInMove) {
                        x.isAllIn = true
                        // Joker freeze (§5): round 1 all-in -> J1+J2 (2), round 2+ -> teeno (3).
                        x.appliedJokers = (Number(matchData?.movesRound || 0) === 0 ? 2 : 3)
                    }
                }
                // ===== BAAKI variants: BILKUL ORIGINAL logic (untouched) =====
                else if (x?.isSeen) {
                    x.totalBet += updatePot
                    x.seenMoves = (x.seenMoves || 0) + 1
                }
                else if (matchData?.raise) {
                    x.totalBet += (updatePot / 2)
                }
                else {
                    x.totalBet += updatePot
                }

                x.turn = false
            }
            else if (nextPlayerTurnId && String(x?.playerId) == String(nextPlayerTurnId)) {
                x.turn = true
            }
        })

        // ZHANDU: round key (movesRound) = sabse bada KHULA joker ka index.
        //   match start  -> movesRound 0 -> jokerCards[0] (J1) pehle hi khula.
        //   last active player ne khela (round poora) -> movesRound++ -> us index ka joker khol do.
        //     round 1 -> jokerCards[1] (J2), round 2 -> jokerCards[2] (J3).
        // Sirf tab jab 2+ active players bache hon (warna game waise hi khatam ho raha).
        let openedJoker = null
        let zhanduUpdate = {}
        if (matchData?.gameType === "zhandu") {
            const stillActive = matchData.playersData.filter(x => !x?.isPacked)
            if (stillActive.length >= 2 && isZhanduRoundComplete(matchData, userId)) {
                const round = (matchData.movesRound || 0) + 1
                const jk = matchData.jokerCards?.[round]   // round = us joker ka index
                if (jk && !jk.opened) {
                    jk.opened = true
                    matchData.movesRound = round
                    zhanduUpdate = { jokerCards: matchData.jokerCards, movesRound: round }
                    openedJoker = jk
                }
            }
        }

        await cancelAutoPack(matchData?._id);
        matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id , turn: userId}, {
            // FOLD free hai -> pot na badhe (pehle fold pe bhi pot += amount ho raha tha =
            // phantom coins/inflation). Sirf actual bet/raise pe pot badhega.
            turn: nextPlayerTurnId, playersData: matchData?.playersData, $inc: { pot: isPacked ? 0 : updatePot },
            currentBetAmount: amount,
            // ...(disconnect ? { $addToSet: { exitPlayers: userId } } : {}),
            ...(matchData?.sideShow ? { sideShow: false } : {}),
            ...(!matchData?.raise && isRaisebet ? { raise: true } : {}),
            ...zhanduUpdate,

        }, { new: true }).populate('players', 'name socketId coins').populate('watchers', '_id name socketId coins').lean()

        // CACHE refresh: authoritative result Redis me daalo -> agla bet (isi match ka) cache-hit.
        await setMatch(matchData)

        // BET DEBIT: fold ke alawa player ke coins se utna kaato jitna pot me gaya (betPut).
        // Non-zhandu me betPut === amount (original). Zhandu all-in me betPut = saare coins.
        // Isse pot = total deducted coins -> winner credit par economy net-zero.
        if (!isPacked && betPut > 0) {
            await userSchema.model.updateOne({ _id: userId }, { $inc: { coins: -betPut } })
        }

        // ZHANDU: joker khula to sab players + watchers ko batao (board pe naya wild dikhe).
        if (openedJoker) this.emitJokerOpened(io, matchData, openedJoker)


        const index = checkIndex(matchData, userId)

        // Fold pe coins nahi ghate; warna jitna daala (betPut) utna ghata do.
        const selfCoin = userData?.coins - (isPacked ? 0 : betPut)
        let selfBet = matchData?.playersData.find(x => String(x?.playerId) == String(userId))
        selfBet = selfBet?.totalBet


        matchData.players.forEach((player) => {
            emitToUser(io, player?._id, socketEmit.successPlaceBet, { _id: matchData?._id, userId, index, isPacked, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, selfCoin, selfBet });
        });


        this.sendCommonEmitForWatcher(io, matchData, socketEmit.successPlaceBet, { _id: matchData?._id, userId, index, isPacked, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, selfCoin, selfBet })

        // ===== ZHANDU: all-in aware routing =====
        if (isZhandu) {
            const contenders = matchData.playersData.filter(x => !x?.isPacked)
            if (contenders.length <= 1) {
                // sab fold, ek bacha -> wahi jeeta (resolveShowdown 1-eligible handle karta).
                await resolveShowdown(io, matchData)
            } else if (nextPlayerTurnId) {
                // Agla BETTOR act kare. All-in ke baad bhi last bettor ko turn milta
                // (call/fold/all-in decide kare) — showdown tabhi jab koi bettor na bache.
                await scheduleFlow("betTurn", { matchId: String(matchData?._id), playerTurnId: String(nextPlayerTurnId) }, 2000)
            } else {
                // 2+ contender par koi bettor act karne ko nahi bacha (sab all-in) -> SHOWDOWN.
                await resolveShowdown(io, matchData)
            }
        }
        // ===== BAAKI variants: ORIGINAL single-winner tail (untouched) =====
        else if (turnManager(matchData?.playersData, nextPlayerTurnId)) {

            // 2s baad next player ka betTurn — BullMQ flow job (reload-safe).
            await scheduleFlow("betTurn", { matchId: String(matchData?._id), playerTurnId: String(nextPlayerTurnId) }, 2000)
        }
        else {

            const data = matchData?.playersData.find(x => String(x?.playerId) == String(nextPlayerTurnId))
            const playerInfo = matchData?.players.find(x => String(x?._id) == String(nextPlayerTurnId))
            const player1 = {
                playerId: nextPlayerTurnId,
                ["index"]: checkIndex(matchData, nextPlayerTurnId),
                name: playerInfo?.name,
                cards: data?.cards
            }

            console.log("::::::::::::::::::player1:::::", player1,)

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.roundWinner, { _id: matchData?._id, winnerId: nextPlayerTurnId, player1, player2: {} });
            });

            this.sendCommonEmitForWatcher(io, matchData, socketEmit.roundWinner, { _id: matchData?._id, winnerId: nextPlayerTurnId, player1, player2: {} })


            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, end: false }, { winner: nextPlayerTurnId, end: true }, { new: true }).populate('players', 'name socketId coins').lean()
            // Winner ko pot credit (sirf jab ye update ne match ko abhi end kiya -> ek hi baar).
            if (matchData) await creditWinnerPot(nextPlayerTurnId, matchData?.pot)
            await deleteMatch(matchData?._id) // match khatam -> cache hata do
            this.startNextRound(io, matchData)
        }

    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    }

}

// Public placeBet — match ka LOCK leta hai, phir core chalata hai, aur
// (success/error/return — kuch bhi ho) finally me taala HAMESHA chhodta hai.
module.exports.placeBet = async (io, user, socketId, data) => {

    // Lock ke variables — try ke bahar isliye taaki `finally` me bhi pahunch ho.
    let lockMatchId = null;
    let lockToken = null;

    try {

        // Lock ke liye sirf match ka _id dhoondo (halki query).
        // Yeh isi player ke turn wala active match hai.
        let userId = socketId ? user?._id : user
        const lockMatch = await matchSchema.model
            .findOne({ start: true, end: false, turn: userId }).sort({ createdAt: -1 })
            .select("_id").lean();

        if (lockMatch) {
            lockMatchId = lockMatch._id;
            lockToken = await acquireLock(lockMatchId);
            // Taala nahi mila => isi match par koi aur action (ya auto-pack timer)
            // abhi chal raha hai. Double-processing se bachne ke liye yahin ruk jao.
            if (!lockToken) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Please retry." });
        }

        // Lock mil gaya (ya match hi nahi mila) -> ab core chalao (matchId hint ke saath).
        return await placeBetCore(io, user, socketId, data, lockMatchId);

    } catch (error) {
        // Yeh sirf lock-lookup/acquire ki error ke liye hai; core apni error khud handle karta hai.
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    } finally {
        // Warna match permanently lock ho jaayega aur uska game atak jaayega.
        if (lockMatchId && lockToken) await releaseLock(lockMatchId, lockToken);
    }

}

module.exports.seenCard = async (io, user, socketId, data) => {

    // Lock ke variables — finally me release ke liye try ke bahar.
    let lockMatchId = null;
    let lockToken = null;

    try {

        let userId = user?._id
        const check = { _id: user?._id, socketId }

        // if turn are run automatic then we will get userId
        console.log(":::::::::::::::seen card BEt:::::::::", { userId, name: user?.name }, typeof user == Object())

        // --- LOCK: isi match par taala (placeBet jaisa hi). Isse "seen ke saath bet"
        // wali race fix: placeBet ki full playersData write seenCard ke isSeen ko
        // overwrite nahi kar paayegi (dono serialize ho jaate hain). ---
        const lockMatch = await matchSchema.model
            .findOne({ players: userId, start: true, end: false })
            .sort({ createdAt: -1 })
            .select("_id").lean();
        if (lockMatch) {
            lockMatchId = lockMatch._id;
            lockToken = await acquireLock(lockMatchId);
            if (!lockToken) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Please retry." });
        }

        let [userData, matchData] = await Promise.all([
            userSchema.model.findOne({ ...check }),
            matchSchema.model.findOne({ players: userId, start: true, end: false }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        ])

        if (!matchData || !userData) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Not your turn." });


        let cards = []
        let alreadySeenCard = false


        matchData.playersData.map((x) => {
            if (String(x?.playerId) == String(userId)) {
                alreadySeenCard = x.isSeen
                cards = x?.cards
            }
        })

        // if (alreadySeenCard) return;

        matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, "playersData.playerId": userId }, {
            $set: {
                "playersData.$.isSeen": true
            }
        }, { new: true }).populate('players', 'name socketId coins').lean()

        // seenCard ne playersData (isSeen) badla -> placeBet ka cache invalidate.
        await deleteMatch(matchData?._id)


        console.log(":::::Seen cards::::::", cards)


        // const index = matchData?.playersData.findIndex(x => (String(x?.playerId) == String(userId)));

        const index = checkIndex(matchData, userId)

        // ZHANDU: user ko apne cards ke saath, abhi KHULE jokers se banne wale BEST possible
        // hand ke resolved CARDS ka array bhejo (frontend sirf cards dikhata). All-in ho to
        // uske applicable jokers hi lagenge (getApplicableJokerValues), warna saare khule.
        let bestHand = []
        if (matchData?.gameType === "zhandu" && Array.isArray(cards) && cards.length) {
            const selfData = matchData?.playersData?.find(x => String(x?.playerId) === String(userId))
            const jokerVals = getApplicableJokerValues(matchData, selfData)
            bestHand = evaluateBestHandWithJoker(cards, jokerVals)?.usedCards
        }

        matchData.players.forEach((player) => {
            if (String(player?._id) == String(userId)) emitToUser(io, player?._id, socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index, cards, bestHand });
            else emitToUser(io, player?._id, socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index, cards: "" });
        });

    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    } finally {
        if (lockMatchId && lockToken) await releaseLock(lockMatchId, lockToken);
    }

}


module.exports.sideShow = async (io, user, socketId, data = {}) => {

    // Lock ke variables — finally me release ke liye try ke bahar.
    let lockMatchId = null;
    let lockToken = null;

    try {
        console.log(":::::::;sideShow :::", data)

        let userId = user?._id
        const check = { _id: user?._id, socketId }

        console.log(":::::::::::::::sideShow :::::::::", { userId, name: user?.name })

        // --- LOCK: isi match par ek time ek hi action (placeBet jaisa hi taala) ---
        const lockMatch = await matchSchema.model
            .findOne({ start: true, end: false, turn: userId })
            .select("_id").lean();
        if (lockMatch) {
            lockMatchId = lockMatch._id;
            lockToken = await acquireLock(lockMatchId);
            if (!lockToken) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Please retry." });
        }

        let [userData, matchData] = await Promise.all([
            userSchema.model.findOne({ ...check }),
            matchSchema.model.findOne({ start: true, end: false, turn: userId }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        ])

        if (!matchData || !userData) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Not your turn." });

        const otherPlayer = sideShowTurnManager(matchData?.playersData, userId)

        const totalActivePlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
        if (totalActivePlayers?.length < 2) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Show not possible right now." });

        const show = totalActivePlayers?.length == 2 ? true : false

        if (!show) {

            // ZHANDU Section 6: side show tabhi allowed jab —
            //   (a) teeno joker khul chuke ho, AUR
            //   (b) requester (userId) ne kam se kam 1 SEEN move kiya ho.
            if (matchData?.gameType === "zhandu") {
                const allJokersOpen = (matchData?.jokerCards?.length || 0) > 0 && matchData.jokerCards.every(j => j?.opened)
                if (!allJokersOpen) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show allowed only after all 3 jokers are opened." });

                const requester = matchData?.playersData?.find(x => String(x?.playerId) === String(userId))
                if (!(requester?.seenMoves >= 1)) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show allowed only after you make a seen move." });
            }

            //For Side show
            const { isSeen, playerId } = otherPlayer
            if (!isSeen || !playerId) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show not possible." });

            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, sideShow: false }, { sideShow: true, sideShowUser: playerId }).populate('players', 'name socketId coins').lean()
            if (!matchData) return;

            // sideShow flag set hua -> cache invalidate.
            await deleteMatch(matchData?._id)

            const from = matchData.players.find(x => String(x?._id) == String(userId)) || {}
            const to = matchData.players.find(x => String(x?._id) == String(playerId)) || {}
            from["index"] = matchData?.seatPosition.find(x => String(x?.playerId) == String(userId))?.index ?? -1
            to["index"] = matchData?.seatPosition.find(x => String(x?.playerId) == String(playerId))?.index ?? -1

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.sideShowRequest, { _id: matchData?._id, from, to, timer: 10 });
            });
        }
        else if (show) {
            //for final show
            // const totalPlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
            // if (totalPlayers?.length != 2) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Show not possible right now." });

            // ZHANDU Section 7: 2-player SHOW pe agar koi joker abhi BAND hai to conditionally
            // kholo. totalActivePlayers ko x.index se sort karo — agar show maangne wala
            // (userId) is sorted array ke LAST (sabse bade index = button) me hai to target
            // uske RIGHT (chhota index) hota -> agla band joker KHULEGA (dono pe apply).
            // Warna (requester chhota index) target = button (left) -> band. Sirf agla ek joker.
            let showOpenedJoker = null
            if (matchData?.gameType === "zhandu") {
                const sortedActive = [...totalActivePlayers].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))
                const requesterIsButton = String(sortedActive[sortedActive.length - 1]?.playerId) === String(userId)
                const nextClosedIdx = (matchData?.jokerCards || []).findIndex(j => !j?.opened)
                if (requesterIsButton && nextClosedIdx !== -1) {
                    matchData.jokerCards[nextClosedIdx].opened = true
                    matchData.movesRound = nextClosedIdx
                    showOpenedJoker = matchData.jokerCards[nextClosedIdx]
                    // compare se PEHLE board update: sab ko batao ek joker khula.
                    this.emitJokerOpened(io, matchData, showOpenedJoker)
                }
            }

            // ZHANDU: khule jokers (getOpenedJokerValues) wild ke roop me pass karo.
            // (upar §7 me jo joker khula wo bhi ab isme count hoga.)
            // classic/joker me jokerValues khali -> jokerValue (single) hi use hoga.
            const { player1, player2, winner } = compareResult(totalActivePlayers[0], totalActivePlayers[1], { gameType: matchData?.gameType, jokerValue: matchData?.jokerCard?.cardValue, jokerValues: getOpenedJokerValues(matchData) })

            // FINAL SHOW TIE (DRAW) handling:
            //  - classic/others: teen patti default -> jisne SHOW maanga (userId = requester)
            //    HAARTA, non-requester jeetta. (koi split nahi)
            //  - zhandu: pot SPLIT hona chahiye (PDF Section 8) -> ye agle step me;
            //    filhaal winnerId null (pot atka rahega; zhandu-split step me theek karenge).
            let winnerId = winner
            let isDraw = false
            let splitAmong = null   // ZHANDU draw: in players me pot equally banta
            if (String(winner) === "DRAW") {
                isDraw = true
                if (matchData?.gameType === "zhandu") {
                    // ZHANDU (PDF Section 8): Show tie -> koi winner nahi, pot dono active
                    // players me EQUALLY split. winner field null (draw:true set karenge).
                    winnerId = null
                    splitAmong = totalActivePlayers.map(x => x?.playerId)
                } else {
                    // classic: jisne show maanga (userId=requester) HAARTA, non-requester jeetta.
                    const nonRequester = totalActivePlayers.find(x => String(x?.playerId) !== String(userId))
                    winnerId = nonRequester?.playerId || null
                }
            }

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.roundWinner, { _id: matchData?._id, player1, player2, winnerId, isDraw, splitAmong });
            });


            await cancelAutoPack(matchData?._id);
            await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, { winner: winnerId, end: true, ...(splitAmong ? { draw: true } : {}), ...(showOpenedJoker ? { jokerCards: matchData.jokerCards, movesRound: matchData.movesRound } : {}) }, { new: true }).populate('players', 'name socketId coins').lean()
            // Payout: ZHANDU draw -> pot equally split; warna winner ko pura pot.
            if (splitAmong) await splitPotEqually(splitAmong, matchData?.pot)
            else await creditWinnerPot(winnerId, matchData?.pot)
            await deleteMatch(matchData?._id) // match khatam -> cache hata do

            this.startNextRound(io, matchData)



        }




    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    } finally {
        if (lockMatchId && lockToken) await releaseLock(lockMatchId, lockToken);
    }
}

module.exports.respondToSideShow = async (io, user, socketId, data = {}) => {

    // Lock ke variables — finally me release ke liye try ke bahar.
    let lockMatchId = null;
    let lockToken = null;

    try {

        const { accept = false } = data

        let userId = user?._id

        console.log("::::::::::::::::::! accept ", data)

        // --- LOCK: pehle sideshow wale match ka _id dhoondo, phir taala lo ---
        // (placeBet ka taala isi match ke liye respondToSideShow ke andar dobara
        //  nahi maanga jaata -> reject branch placeBetCore call karta hai, deadlock nahi.)
        const lockMatch = await matchSchema.model
            .findOne({ start: true, end: false, sideShow: true, sideShowUser: userId })
            .select("_id").lean();
        if (lockMatch) {
            lockMatchId = lockMatch._id;
            lockToken = await acquireLock(lockMatchId);
            if (!lockToken) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Please retry." });
        }

        let matchData = await matchSchema.model.findOneAndUpdate({ start: true, end: false, sideShow: true, sideShowUser: userId }, { sideShow: false, sideShowUser: null }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        if (!matchData) return;
        // sideShow resolve hua -> cache invalidate (placeBetCore / agla read fresh padhe).
        await deleteMatch(matchData?._id)
        console.log("::::::::::::::::::2222 accept ", data)


        const totalPlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
        if (totalPlayers?.length < 3) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "side Show not possible right now." });

        await cancelAutoPack(matchData?._id);

        console.log("::::::::::::::::::!333333333333 accept ")

        let otherPlayerId = matchData?.turn
        if (accept) {

            const p1 = totalPlayers.find(x => String(x?.playerId) == String(userId))
            const p2 = totalPlayers.find(x => String(x?.playerId) == String(otherPlayerId))

            // ZHANDU: side-show comparison bhi khule jokers ke saath.
            const { player1, player2, winner } = compareResult(p1, p2, { gameType: matchData?.gameType, jokerValue: matchData?.jokerCard?.cardValue, jokerValues: getOpenedJokerValues(matchData) })
            const p1Np2Id = [String(userId), String(otherPlayerId)]

            // SIDE SHOW TIE (DRAW): PDF Section 8 -> jisne side show REQUEST kiya wo HAARTA.
            //   userId = responder (jise poocha gaya), otherPlayerId (=turn) = requester.
            //   - DRAW  -> requester (otherPlayerId) pack.
            //   - warna -> jiska card kamzor wo pack.
            // (Ye rule classic + zhandu dono me same hai — side show me koi split nahi.)
            const looserId = String(winner) === "DRAW"
                ? otherPlayerId
                : (String(winner) === String(userId) ? otherPlayerId : userId)
            // Resolved winner = looser ke alawa doosra (client "DRAW" ki jagah asli winner dekhe).
            const resolvedWinnerId = String(looserId) === String(userId) ? otherPlayerId : userId

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.sideShowWinner, { _id: matchData?._id, player1, player2, winnerId: resolvedWinnerId, looserId, isDraw: String(winner) === "DRAW" });
            });

            let nextPlayerTurnId = turnManager(matchData?.playersData, otherPlayerId,)

            if (!nextPlayerTurnId) return


            matchData.playersData.map((x) => {
                if (String(x?.playerId) == String(looserId)) {
                    x.isPacked = true
                    x.turn = false
                }
            })
            // isPacked emit userId (responder) ke liye hai -> kya responder khud pack hua?
            const isPacked = String(looserId) === String(userId)

            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, {
                turn: nextPlayerTurnId, playersData: matchData?.playersData
            }, { new: true }).populate('players', 'name socketId coins').lean()

            // turn/playersData badla -> cache invalidate (agla placeBet fresh padhe).
            await deleteMatch(matchData?._id)


            const index = checkIndex(matchData, userId)

            const selfCoin = user?.coins
            let selfBet = matchData?.playersData.find(x => String(x?.playerId) == String(userId))
            selfBet = selfBet?.totalBet


            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.successPlaceBet, { _id: matchData?._id, userId, index, isPacked, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, selfCoin, selfBet });
            });

            // 2s baad next player ka betTurn — BullMQ flow job (reload-safe).
            await scheduleFlow("betTurn", { matchId: String(matchData?._id), playerTurnId: String(nextPlayerTurnId) }, 2000)

            // this.placeBet(io, looserId, null, {
            //     isPacked: true,
            //     amount: 0,
            // });

        } else {

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.rejectSideShow, { _id: matchData?._id, from: userId, to: otherPlayerId });
            });

            // Lock pehle se held hai -> placeBetCore call karo (locked placeBet nahi),
            // warna same match ka taala dobara maangne se DEADLOCK ho jaata.
            await placeBetCore(io, otherPlayerId, null, {
                isPacked: false,
                amount: matchData?.currentBetAmount,
            }, matchData?._id);
        }


    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    } finally {
        if (lockMatchId && lockToken) await releaseLock(lockMatchId, lockToken);
    }
}


module.exports.startNextRound = async (io, matchData) => {
    try {
        let exitPlayers = matchData.exitPlayers?.map(x => String(x))
        let players = matchData.players.filter(x => {
            if (x?._id && !exitPlayers.includes(String(x?._id))) return String(x?._id)
        })

        let seatPosition = matchData.seatPosition.filter(x => {
            //We can change this in  future only new player save the player array
            if (x?.playerId && !exitPlayers.includes(String(x?.playerId))) return x
        })


        // let [newMatch] = await Promise.all([
        //     matchSchema.model.create({ players, roomId: matchData?.roomId, seatPosition, waitForNextRount: true, watchers: matchData?.watchers, gameType: matchData?.gameType })
        // ])
        // newMatch = newMatch.toObject()

        // // 5s baad agla round shuru — BullMQ flow job (reload-safe; pehle setTimeout tha).
        // await scheduleFlow("startNext", { matchId: String(newMatch?._id) }, 5000)

         let [newMatch] = await Promise.all([
            matchSchema.model.create({roomId: matchData?.roomId, gameType: matchData?.gameType,roomName: matchData?.roomName,})
        ])

    } catch (error) {
        console.log(error);
    }
}


// ===== BullMQ FLOW-JOB HANDLERS (worker inko call karta hai) ================
// Ye pehle in-process setTimeout the -> process restart/reload pe match atak jaata tha.
// Ab BullMQ delayed jobs se chalte hain -> koi bhi worker uthaake match aage badha deta hai.

// Next player ka betTurn (2s/20s delay ke baad). Match fresh load -> turn validate ->
// sendBetTurnEmit (jo 30s auto-pack bhi schedule karta hai).
module.exports._flowBetTurn = async (io, matchId, playerTurnId) => {
    try {
        const match = await getMatch(matchId, { populate: true })
        if (!match || match.end || !match.start) return
        // Turn aage badh gaya (koi aur action ho chuka) -> skip (double betTurn na ho).
        if (String(match.turn) !== String(playerTurnId)) return
        await sendBetTurnEmit(io, playerTurnId, match)
    } catch (e) {
        console.log("_flowBetTurn error =>", e.message)
    }
}

// Match start ke 5s baad: cards emit + 20s baad pehla betTurn schedule.
module.exports._flowDealCards = async (io, matchId) => {
    try {
        const match = await getMatch(matchId, { populate: true })
        if (!match || match.end || !match.start) return

        match.players.forEach((player) => {
            emitToUser(io, player?._id, socketEmit.cardDistributeSuccess, { message: "Card Distribuation success.", _id: match?._id, jokerCard: match?.jokerCard, jokerCards: match?.jokerCards })
        })
        module.exports.sendCommonEmitForWatcher(io, match, socketEmit.cardDistributeSuccess)

        // Pehla betTurn ka delay (baad me per-player DYNAMIC karna ho to sirf yahi variable
        // badlo — neeche firstJoker uspe based hai).
        const betTurnDelay = 20000

        // ZHANDU: J1 (first joker) ka jokerOpened emit betTurn se 2s PEHLE bhejo, taaki client
        // turn shuru hone se pehle joker khulta dikha sake. (J2/J3 to placeBet me khulte hi hain.)
        if (match?.gameType === "zhandu") {
            await scheduleFlow("firstJoker", { matchId: String(match?._id) }, Math.max(0, betTurnDelay - 2000))
        }

        // betTurnDelay baad pehla betTurn (current turn player).
        await scheduleFlow("betTurn", { matchId: String(match?._id), playerTurnId: String(match?.turn) }, betTurnDelay)
    } catch (e) {
        console.log("_flowDealCards error =>", e.message)
    }
}

// ZHANDU: joker khulne par sab players + watchers ko jokerOpened emit — COMMON helper.
// (3 jagah use hota: J1 firstJoker, J2/J3 placeBet, §7 show. DRY ke liye ek jagah.)
module.exports.emitJokerOpened = (io, match, joker) => {
    if (!match || !joker) return
    match.players.forEach((player) => {
        emitToUser(io, player?._id, socketEmit.jokerOpened, { _id: match?._id, joker, jokerCards: match?.jokerCards, movesRound: match?.movesRound })
    })
    module.exports.sendCommonEmitForWatcher(io, match, socketEmit.jokerOpened, { joker, jokerCards: match?.jokerCards, movesRound: match?.movesRound })
}

// ZHANDU: pehla betTurn shuru hone se 2s PEHLE J1 (first joker) ka jokerOpened emit.
// J1 data me match-start se hi khula (opened:true) hota; ye emit sirf client ko turn se
// pehle "joker khula" dikhane/animate karne ke liye hai (J2/J3 jaisa consistent).
module.exports._flowFirstJoker = async (io, matchId) => {
    try {
        const match = await getMatch(matchId, { populate: true })
        if (!match || match.end || !match.start) return
        const j1 = match?.jokerCards?.[0]
        if (!j1 || !j1.opened) return
        module.exports.emitJokerOpened(io, match, j1)
    } catch (e) {
        console.log("_flowFirstJoker error =>", e.message)
    }
}

// Round khatam ke 5s baad: agla match shuru (agar minPlayer enough hain).
module.exports._flowStartNext = async (io, matchId) => {
    try {
        const updateMatch = await matchSchema.model.findOneAndUpdate({ _id: matchId }, { waitForNextRount: false }).lean()
        if (updateMatch && updateMatch.players.length >= gameConfig?.minPlayer) module.exports.startMatch(io, updateMatch)
    } catch (e) {
        console.log("_flowStartNext error =>", e.message)
    }
}

// Reconnect ke baad client current match state maang sakta hai (resyncMatch event).
// Reload/disconnect ke beech jo emits miss hue, isse board turant sahi ho jaata hai.
module.exports.resyncMatch = async (io, user, socketId, data = {}) => {
    try {
        const userId = user?._id

        // User jis active match me hai usko dhoondo.
        const match = await matchSchema.model.findOne({ players: userId, end: false }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        if (!match) return io.to(socketId).emit(socketEmit.resyncMatchSuccess, { message: "No active match", match: null })

        // Players seat-index ke saath.
        const players = match.players.map(p => ({ ...p, index: checkIndex(match, p?._id) }))

        // Sirf IS user ke apne cards (baaki private). Cards tabhi jab usne seen kiya ho.
        const self = match.playersData?.find(x => String(x?.playerId) === String(userId))

        const payload = {
            _id: match?._id,
            roomId: match?.roomId,
            gameType: match?.gameType,
            start: match?.start,
            end: match?.end,
            turn: match?.turn,
            pot: match?.pot,
            currentBetAmount: match?.currentBetAmount,
            jokerCard: match?.jokerCard,
            // ZHANDU: reconnect pe board sahi dikhe -> 3 jokers (kaun khula/band) + round key.
            jokerCards: match?.jokerCards,
            movesRound: match?.movesRound,
            players,
            // playersData me sabke cards nahi bhejte (private) — sirf state. seenMoves bhi
            // bhejte hain (client side-show button enable/disable kar sake — ZHANDU §6).
            playersData: match?.playersData?.map(x => ({ playerId: x?.playerId, index: x?.index, turn: x?.turn, isPacked: x?.isPacked, isSeen: x?.isSeen, seenMoves: x?.seenMoves, totalBet: x?.totalBet })),
            myCards: self?.isSeen ? self?.cards : "",
            selfId: userId,
        }

        return io.to(socketId).emit(socketEmit.resyncMatchSuccess, { message: "Resync success", match: payload })
    } catch (error) {
        console.log(error)
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message })
    }
}


//self exit
module.exports.selfExit = async (io, user, socketId, disconnect = false) => {
    console.log(":::: Self Exit :::: ");


    await Promise.all([
        userSchema.model.findOneAndUpdate({ _id: user?._id, socketId }, { socketId: null }),
        // matchSchema.model.updateMany({ players: user?._id, start: true, end: false }, {
        //     $addToSet: { exitPlayers: user?._id },
        //     //$pull: { players: user?._id, seatPosition: { playerId: user._id } }
        // }),
        // matchSchema.model.updateMany({ players: user?._id, start: false, end: false }, {
        //     // $addToSet: { exitPlayers: user?._id },
        //     $pull: { players: user?._id, seatPosition: { playerId: user._id } }
        // })
    ])
    return;

};

module.exports.roomList = async (io, user, socketId, data = {}) => {
    try {

        console.log(":::: roomList::::::::::::rommList :::: ");
        const { limit = 20, offset = 0 } = data

        const list = await matchSchema.model.aggregate([
            {
                $match: {
                    end: false
                }
            },
            {
                $project: {
                    totalActivePlayers: {
                        $subtract: [
                            { $size: { $ifNull: ["$players", []] } },
                            { $size: { $ifNull: ["$exitPlayers", []] } }
                        ]
                    },
                    roomId: 1,
                    start: 1,
                    end: 1
                }
            }
        ])

        return io.to(socketId).emit(socketEmit.fetchRoomList, { message: "Fetch Room List success", list });
    } catch (error) {
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    }

};


module.exports.fetchLobbyList = async (io, user, socketId, data = {}) => {
    console.log(":::: roomList::::::::::::rommList :::: ");
    const { } = data

    const list = await matchSchema.model.aggregate([
        {
            $match: {
                end: false
            }
        },
        {
            $project: {
                totalActivePlayers: {
                    $subtract: [
                        { $size: { $ifNull: ["$players", []] } },
                        { $size: { $ifNull: ["$exitPlayers", []] } }
                    ]
                },
                roomId: 1,
                start: 1,
                end: 1,
                watchers: { $size: "$watchers" },
                entryCoins: { $literal: 1000 },
                roomName: 1
            }
        }
    ])

    return io.to(socketId).emit(socketEmit.fetchLobbyList, { message: "Fetch Room List success", list });

};


module.exports.watchRoom = async (io, user, socketId, data = {}) => {
    console.log(":::: roomList::::::::::::rommList :::: ");
    try {

        const { roomId } = data

        if (!roomId) return;

        const matchData = await matchSchema.model.findOneAndUpdate({ roomId }, { $addToSet: { watchers: user?._id } }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()

        // watcher add hua -> cache invalidate (cached watchers refresh ho).
        await deleteMatch(matchData?._id)

        matchData.players.forEach((player) => {
            player['index'] = checkIndex(matchData, player?._id)
        })

        const payload = {
            _id: matchData?._id,
            turn: matchData?.turn,
            players: matchData?.players,
            timer: 10,
            roomId: matchData?.roomId
        }


        io.to(socketId).emit(socketEmit.watchRoom, { message: "Fetch Room List success", ...payload });
    } catch (error) {
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });

    }
};


module.exports.joinRoomNew = async (io, user, socketId, data = {}) => {
    try {
        let { roomId, index = -1 } = data;

        console.log("::::::::::::::::::::Join Room::::::::", user?.name, data);

        if (!roomId || index < 0) return;

        let [userData, matchData] = await Promise.all([
            userSchema.model.findOne({ _id: user?._id, socketId }),
            matchSchema.model.findOneAndUpdate({
                roomId,
                players: { $ne: user?._id },
                end: false,
                seatPosition: {
                    $not: {
                        $elemMatch: { index: index }
                    }
                }
            },
                {
                    $addToSet: { players: user?._id },
                    $push: { seatPosition: { playerId: user?._id, index } },
                    $pull: { watchers: user?._id }
                },
                { new: true }
            ).sort({ createdAt: -1 }).populate('players', '_id name socketId coins').
                populate('watchers', '_id name socketId coins').lean()
        ]);


        console.log("::::::::::::::::::::Jo2222222222in Room::::::::", userData?.name, matchData);

        if (!userData || !matchData) return io.to(socketId).emit(socketEmit.errorLog, { message: "Invalid match id ." });

        // players/seat badle -> cache invalidate.
        await deleteMatch(matchData?._id)


        // send emit
        this.sendCommonEmit(io, matchData, socketEmit.joinRoomSuccess)
        this.sendCommonEmitForWatcher(io, matchData, socketEmit.joinRoomSuccess)


        if (matchData?.start == false && (matchData?.players.length == gameConfig?.minPlayer) && !matchData?.waitForNextRount) {
            this.startMatch(io, matchData)
        }


    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    }
};

module.exports.sendCommonEmit = (io, matchData, emit) => {
    try {

        matchData.players = matchData.players.map(player => {
            const seat = matchData.seatPosition.find(
                x => String(x?.playerId) === String(player?._id)
            );
            if (seat) return { ...player, index: seat?.index ?? -1 }
        });

        const payload = {
            _id: matchData?._id,
            players: matchData?.players,
            roomId: matchData?.roomId,
            gameType: matchData?.gameType,
            start: matchData?.start,
            end: matchData?.end,
        }


        console.log("::::::;;chy,matchData.players", matchData.players)

        matchData?.players.map((x) => {
            emitToUser(io, x?._id, emit, { ...payload, selfId: x?._id })
        })

    } catch (error) {
        console.log(":::::::::::::errrrrr send coom emit:::::", error)
    }

}


module.exports.sendCommonEmitForWatcher = (io, matchData, emit, data = {}) => {
    try {
        const { watchers, start, end } = matchData


        console.log("::::::::::;;;watchers ::::::::::::::::send::::", matchData?.watchers)

        if (!matchData || watchers.length == 0) return

        players = matchData.players.map(player => {
            const seat = matchData.seatPosition.find(
                x => String(x?.playerId) === String(player?._id)
            );
            if (seat) return { ...player, index: seat?.index ?? null }
        });

        const payload = {
            _id: matchData?._id, players, roomId: matchData?.roomId, start, end,
        }


        matchData?.watchers && watchers.map((x) => {
            emitToUser(io, x?._id, emit, { ...payload, selfId: x?._id, ...data })
        })

    } catch (error) {
        console.log(":::::::::::::errrrrr send coom emit: to watcher:::::::", error)
    }

}


