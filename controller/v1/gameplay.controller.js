const { socketEmit, gameConfig, gameTypeConfig, zhanduConfig ,gameTypeConstant,roomList,callbackType} = require("../../helper/appConstant");
const mongoose = require("mongoose");
const userSchema = require("../../model/user.model");
const matchSchema = require("../../model/match.model");
const economySchema = require("../../model/economy.mode.")
const gameSessionSchema = require("../../model/gameSession.model");
const cardDeck = require("../../helper/card.json");
const { turnManager, sideShowTurnManager, compareResult, parseMongoObjectId, checkIndex, getOpenedJokerValues, getApplicableJokerValues, buildSidePots, pickPotWinners, evaluateBestHandWithJoker, previousWinnerIndex, buildFlipperJokers, replaceVariableJokers } = require("../../helper/utils");
const { acquireLock, releaseLock } = require("../../helper/lock.helper");
const { emitToUser } = require("../../helper/emit.helper");
const { scheduleAutoPack, cancelAutoPack, scheduleFlow, getAutoPackRemainingMs } = require("../../helper/turnTimer.helper");
const { getMatch, setMatch, deleteMatch } = require("../../helper/matchState.helper");
const {notifyResult}=require('./user.controller')
const moment = require('moment')

global.roomTimeouts = {};
global.dashCallTimeouts = {};

// Disconnect ke baad itni der ka grace period. Iske andar wapas aa gaya to session zinda,
// warna close. Refresh/network drop bhi disconnect hi hota hai — isliye turant band nahi karte.
const SESSION_CLOSE_MS = 2 * 1000;   // 30 sec — itne me wapas nahi aaya to session close

// Round khatam hone se agla round shuru hone tak ka gap. Ye EK hi jagah define hai —
// `startNextRound` isi se BullMQ job schedule karta hai AUR `roundWinner` payload me
// `nextRoundIn` bhej deta hai, taaki client apna hardcoded countdown na chalaye
// (pehle client ka timer server se alag tha -> match "jaldi" start hota dikhta tha).
const NEXT_ROUND_MS = 20000;              // 10s
const NEXT_ROUND_SEC = NEXT_ROUND_MS / 1000;

// FLIPPER §4 (decision D3): all-in ke forced side show ke baad agli cheez (agla betTurn,
// ya chain ka agla link) itni der baad. Client ko dono hand ka reveal + winner animation
// dikhane ka time chahiye. Ek hi jagah define hai taaki live test me tuning ek line ho.
const FLIPPER_CHAIN_MS = 3000;            // 3s


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


const isZhanduRoundComplete = (matchData, justActedId) => {
    // Round bettors ke turns se complete hota. All-in player bet nahi karta -> use bhi
    // skip karo (par abhi jisne act kiya usko include karo, chahe wo fold/all-in ho).
    const active = (matchData?.playersData || [])
        .filter(x => (!x?.isPacked && !x?.isAllIn) || String(x?.playerId) === String(justActedId))
        .sort((a, b) => checkIndex(matchData, a?.playerId) - checkIndex(matchData, b?.playerId));

    const last = active[active.length - 1];
    return last && String(last?.playerId) === String(justActedId);
};

const creditWinnerPot = async (winnerId, pot) => {
    if (!winnerId || String(winnerId) === "DRAW" || !mongoose.Types.ObjectId.isValid(winnerId)) return;
    if (!pot || pot <= 0) return;
    await userSchema.model.updateOne({ _id: winnerId }, { $inc: { coins: pot } });
};

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
        let bootAmount = 0
        let currentBetAmount = startMatch?.bootAmount

        sortPlayer.map((x) => {
            bootAmount = bootAmount + startMatch?.bootAmount
        })

        console.log(`[nextRound] matchStart EMIT room=${startMatch?.roomId} match=${startMatch?._id} @${new Date().toISOString()}`)
        // this.sendCommonEmit(io, startMatch, socketEmit.matchStart)
        // this.sendCommonEmitForWatcher(io, startMatch, socketEmit.matchStart)

        //----------Update Economy-------
        await Promise.all([
            userSchema.model.updateMany({ $expr: { $in: ["$_id", startMatch?.players?.map(x => x?._id)] } }, { $inc: { coins: - (startMatch?.bootAmount) } })
        ])


        //Distribute Card
        const cards = shuffle(cardDeck)

        // how many cards to deal depends on the game variant (teenpatti=3, fourcard=4, ...)
        const { cardsPerPlayer } = gameTypeConfig[startMatch?.gameType] || gameTypeConfig.teenpatti


        let jokerCard = null
        if (startMatch?.gameType === gameTypeConstant?.JOKER) jokerCard = cards.pop()

        let jokerCards = []
        if (startMatch?.gameType === gameTypeConstant?.ZHANDU) {
            for (let i = 0; i < (zhanduConfig?.jokerCount || 3); i++) {
                jokerCards.push({ card: cards.pop(), opened: i === 0 })
            }
        }
        // FLIPPER: 4 joker (3 variable + 1 fixed) aur chaaron shuru se hi khule.
        // Isliye flipper me movesRound ka koi kaam nahi — 0 hi pada rehta hai.
        else if (startMatch?.gameType === gameTypeConstant?.FLIPPER) {
            jokerCards = buildFlipperJokers(cards)
        }

        const playersData = []
        sortPlayer.map((x) => {
            if (x?._id && x?.index >= 0) playersData.push({ playerId: x?._id, cards: cards.splice(-cardsPerPlayer), turn: !playersData[0] ? true : false, index: x?.index,totalBet:currentBetAmount })
        })

        const currentPlayerTurn = playersData[0]?.playerId


        startMatch = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, }, { playersData, pot: bootAmount, turn: currentPlayerTurn, currentBetAmount, jokerCard, jokerCards, movesRound: 0 }, { new: true }).populate('players', 'name socketId coins').populate('watchers', '_id name socketId coins').lean()

        // CACHE seed: round shuru -> authoritative match cache me daal do (pehla bet cache-hit).
        await setMatch(startMatch)

        this.sendCommonEmit(io, startMatch, socketEmit.matchStart)
        this.sendCommonEmitForWatcher(io, startMatch, socketEmit.matchStart)

        // 5s baad cards emit (uske 20s baad pehla betTurn) — dono BullMQ flow jobs.
        await scheduleFlow("dealCards", { matchId: String(startMatch?._id) }, 5000)


    } catch (error) {
        console.log("::::::::::::::::::::::::::::::::::::::start match error::::::::::", error)
        // return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });

    }
};


const sendBetTurnEmit = async (io, currentPlayerTurnId, matchData,seenCard=false) => {


    try {

        let index = checkIndex(matchData, currentPlayerTurnId)

        const totalActivePlayers = matchData?.playersData?.filter(x => !x?.isPacked && !x?.isAllIn) || [];

        const otherPlayerForSideShow = sideShowTurnManager(matchData?.playersData, currentPlayerTurnId)

        const seenPlayer=matchData?.playersData?.find(x=>String(x?.playerId)===String(currentPlayerTurnId))?.isSeen
        const previousWinner=String(matchData?.previousWinner) === String(currentPlayerTurnId)
        let showEnable = totalActivePlayers.length == 2 || (otherPlayerForSideShow?.isSeen && seenPlayer) ? true : false

        

        if(matchData?.gameType==gameTypeConstant?.ZHANDU) {
            const seenMove=matchData.playersData.find(x=>String(x?.playerId)===String(currentPlayerTurnId))?.seenMoves || 0
            const openJokerCount=matchData?.jokerCards?.filter(x=>x?.opened)?.length || 0
            if(seenMove>0 && openJokerCount==3 && otherPlayerForSideShow?.isSeen && seenPlayer) showEnable=true
            else if(totalActivePlayers.length == 2)showEnable=true
            else showEnable=false
        }
        // FLIPPER: side show tabhi jab SAARE bache hue players seen ho chuke hon, aur
        // maangne wale ne khud kam se kam ek seen move kar liya ho.
        // (Zhandu wali "teeno joker khule" wali shart yahan bematlab hai — flipper me
        //  joker to shuru se hi khule hote hain.)
        else if(matchData?.gameType==gameTypeConstant?.FLIPPER) {
            const seenMove=matchData.playersData.find(x=>String(x?.playerId)===String(currentPlayerTurnId))?.seenMoves || 0
            const allPlayersSeen=totalActivePlayers.every(x=>x?.isSeen)
            if(seenMove>0 && allPlayersSeen) showEnable=true
            else if(totalActivePlayers.length == 2)showEnable=true
            else showEnable=false
        }
        const exitPlayers = matchData?.exitPlayers?.map(x => String(x)).includes(String(currentPlayerTurnId))

        let currentBetAmount= matchData?.currentBetAmount
      
        if(seenPlayer && previousWinner )currentBetAmount=currentBetAmount*4
        else if(seenPlayer || previousWinner)currentBetAmount=currentBetAmount*2
        // const betLimit=matchData?.betLimit-matchData?.currentBetAmount
        const betLimit=matchData?.betLimit

        console.log("::::::::::::::::::::bet amount::::::::::::::::",{currentBetAmount,seenPlayer , previousWinner,p:matchData?.previousWinner,c:currentPlayerTurnId})


        matchData?.players.forEach((player) => {
            // Client ko "All In" button dikhane ka flag. FLIPPER me bhi all-in hai (§4),
            // isliye wo bhi shamil — warna player ke paas move hi nahi bachta jab coins
            // minimum bet se kam ho jaayein.
            let isAllIn=Number(currentBetAmount) >= Number(player?.coins) && (matchData?.gameType==gameTypeConstant?.ZHANDU || matchData?.gameType==gameTypeConstant?.FLIPPER)
            if(String(player?._id)===String(currentPlayerTurnId) && exitPlayers) return
            else emitToUser(io, player?._id, socketEmit.betTurn, { _id: matchData?._id, userId: currentPlayerTurnId, timer: 30, index, currentBetAmount, pot: matchData?.pot, showEnable: showEnable,betLimit,isAllIn,timerReset:!seenCard ,seenPlayer});
        });

        matchData?.watchers.forEach((player) => {
            if(String(player?._id)===String(currentPlayerTurnId) && exitPlayers) return
            else emitToUser(io, player?._id, socketEmit.betTurn, { _id: matchData?._id, userId: currentPlayerTurnId, timer: 30, index, currentBetAmount, pot: matchData?.pot, showEnable: showEnable,gameType: matchData?.gameType,isAllIn:false,seenPlayer });
        });

        if(seenCard) return;

        // koi matlab nahi — usko betTurn emit bhi nahi gaya — isliye 2s me hi auto-pack.
       if(exitPlayers) await scheduleAutoPack(matchData?._id, currentPlayerTurnId,  2000);
       else await scheduleAutoPack(matchData?._id, currentPlayerTurnId);

    } catch (error) {
        throw new Error(error)
    }

}



// roundWinner ke saath winner ke CARDS bhejne ke liye. Pehle har round-end branch
// apne alag shape me cards deta tha (showdown -> `reveal` map, fold-win -> `player1`,
// show -> `player1`/`player2`), to client ko teen jagah dekhna padta tha. Ye helper
// ek hi uniform `winnersCards` banata hai jo teeno paths pe same rehta hai.
// Multi-pot me ek player kai pot jeet sakta hai -> ids dedupe kar dete hain.
const buildWinnersCards = (matchData, winnerIds = []) => {
    const ids = [...new Set((winnerIds || []).filter(Boolean).map(String))]
    return ids.map(id => {
        const pd = matchData?.playersData?.find(x => String(x?.playerId) === id)
        const info = matchData?.players?.find(x => String(x?._id) === id)
        return {
            playerId: id,
            index: checkIndex(matchData, id),
            name: info?.name,
            cards: pd?.cards || []
        }
    })
}

const resolveShowdown = async (io, matchData) => {
    // boot ALAG SE pass nahi karte — playersData ke totalBet me boot pehle se hi shamil hai.
    const pots = buildSidePots(matchData?.playersData)

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

    // Saare pot winners ke cards (main winner sabse pehle).
    const winnersCards = buildWinnersCards(matchData, [mainWinner, ...potResults.flatMap(r => r?.winners || [])])
    const winnerCards = winnersCards.find(x => String(x?.playerId) === String(mainWinner))?.cards || []

    // Non-folded players ke cards reveal (client showdown dikha sake).
    const reveal = {}
    matchData.playersData.forEach(pd => {
        if (!pd?.isPacked) reveal[String(pd?.playerId)] = { cards: pd?.cards, index: checkIndex(matchData, pd?.playerId) }
    })

    const previousWinnerSeatIndex = previousWinnerIndex(matchData, matchData?.previousWinner)


    // matchData.players.forEach(player => {
    //     emitToUser(io, player?._id, socketEmit.roundWinner, { _id: matchData?._id, winnerId: mainWinner, pots: potResults, reveal, isShowdown: true, previousWinnerSeatIndex, nextRoundIn: NEXT_ROUND_SEC })
    // })
    this.sendCommonEmitForWatcher(io, matchData, socketEmit.roundWinner, { _id: matchData?._id, winnerId: mainWinner, winnerCards, winnersCards, pots: potResults, reveal, isShowdown: true, previousWinnerSeatIndex, nextRoundIn: NEXT_ROUND_SEC })

    await cancelAutoPack(matchData?._id)
    matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, end: false }, { end: true, winner: mainWinner, pots: potResults }, { new: true }).populate('players', 'name socketId coins').lean()

    matchData.players.forEach(player => {
        emitToUser(io, player?._id, socketEmit.roundWinner, { _id: matchData?._id, winnerId: mainWinner, winnerCards, winnersCards, pots: potResults, reveal, isShowdown: true, previousWinnerSeatIndex, nextRoundIn: NEXT_ROUND_SEC ,selfCoin: player?.coins});
    })
    await deleteMatch(matchData?._id)
    this.startNextRound(io, matchData)
}

const placeBetCore = async (io, user, socketId, data, matchIdHint = null) => {

    try {

        let { amount, isPacked, isRaisebet ,betAmount} = data;

        if(!isPacked && !betAmount) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Invalid bet amount." });
        console.log("::::::placeBetCore:::::::",data)
        betAmount=Number(betAmount)

        let userId = socketId ? user?._id : user
        const check = socketId ? { _id: user?._id, socketId} : { _id: user }

        // if turn are run automatic then we will get userId

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
        const seenPlayer=matchData?.playersData?.find(x=>String(x?.playerId)===String(userId))?.isSeen
        const previousWinner=String(matchData?.previousWinner) === String(userId)
        let currentBet = Number(matchData?.currentBetAmount)
        const isZhandu = matchData?.gameType === gameTypeConstant?.ZHANDU
        const isFlipper= matchData?.gameType === gameTypeConstant?.FLIPPER
        let isAllInMove = false
        isPacked = isPacked || false
        const myCoins = Number(userData?.coins) || 0

        if(!isPacked){
            let minBetPut =matchData?.currentBetAmount
            if(seenPlayer && previousWinner ) minBetPut = minBetPut*4
            else if(seenPlayer || previousWinner) minBetPut = minBetPut*2

            if((betAmount < minBetPut) && myCoins>=minBetPut) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Insufficient coins." });

            // FLIPPER bhi zhandu ki tarah all-in support karta hai (§4), isliye usko bhi
            // is "kam bet allowed nahi" wali rok se bahar rakha — all-in me bet minBet se
            // kam hota hi hai (jitne coins bache utne hi).
            if(!isZhandu && !isFlipper && (betAmount < minBetPut)) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Insufficient coins." });

            // Zhandu aur flipper ka bet-calculation bilkul same hai (dono me all-in hai),
            // isliye ek hi branch — alag copy rakhne se kal ko ek jagah fix, doosri jagah bug.
            if(isZhandu || isFlipper){
                if(myCoins <= minBetPut) {
                    isAllInMove=true
                    currentBet = currentBet
                }
                else if(betAmount > myCoins) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Insufficient coins." });
                else if(betAmount > minBetPut){

                    if(seenPlayer && previousWinner) currentBet = betAmount / 4;
                    else if(seenPlayer || previousWinner) currentBet = betAmount /2;
                    else currentBet = betAmount
                } 
                else if(betAmount == minBetPut)  currentBet = currentBet
            }
            else {
                if(betAmount > myCoins) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Insufficient coins." });
                else if(betAmount > minBetPut){

                    if(seenPlayer && previousWinner) currentBet = betAmount / 4;
                    else if(seenPlayer || previousWinner) currentBet = betAmount /2;
                    else currentBet = betAmount
                } 
                else if(betAmount == minBetPut)  currentBet = currentBet
            }
        }

        let betPut = isPacked ? 0 : betAmount   //this betput save in playerdata and add in pot
        if ((isZhandu || isFlipper) && isAllInMove) {
            betPut = myCoins
        }

        if (!isPacked && (betPut <= 0 || betPut > myCoins))  return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Insufficient coins." });
        

        let nextPlayerTurnId = turnManager(matchData?.playersData, userId)

        // Non-zhandu: agla turn nahi -> return (ORIGINAL behaviour, chhedo mat).
        // Zhandu: showdown tail handle karega (all-in me bettor khatam ho sakta).
        // FLIPPER all-in: yahan bhi nextPlayerTurnId null aa sakta hai (all-in wala khud
        // turnManager se filter ho jaata) — par forced side show to phir bhi chalana hai,
        // isliye us case ko chhoot di. Flipper ki normal chaal purane raste se hi jaati hai.
        if (!isZhandu && !(isFlipper && isAllInMove) && !nextPlayerTurnId) return;

        matchData.playersData.map((x) => {
            if (String(x?.playerId) == String(userId)) {

                if (isPacked) { x.isPacked = true }
                // ===== ZHANDU: all-in aware (totalBet = actual betPut, side-pot ke liye) =====
                else if (isZhandu) {
                   // x.totalBet += betPut
                    if (x?.isSeen) x.seenMoves = (x.seenMoves || 0) + 1
                    if (isAllInMove) {
                        x.isAllIn = true
                        // Joker freeze (§5): round 1 all-in -> J1+J2 (2), round 2+ -> teeno (3).
                        x.appliedJokers = (Number(matchData?.movesRound || 0) === 0 ? 2 : 3)
                    }
                }
                // ===== FLIPPER: all-in mark, par joker FREEZE nahi =====
                // Zhandu me all-in wale ke jokers freeze hote hain (appliedJokers) kyunki
                // wahan joker baad me khulte hain. Flipper me chaaron shuru se khule hote
                // hain -> freeze karne ko kuch hai hi nahi. Uska hisaab forced side show
                // (allInSideShow) karta hai, yahan bas flag laga do.
                else if (isFlipper) {
                    if (x?.isSeen) x.seenMoves = (x.seenMoves || 0) + 1
                    if (isAllInMove) x.isAllIn = true
                }
                // ===== BAAKI variants: BILKUL ORIGINAL logic (untouched) =====
                else if (x?.isSeen) {
                    x.seenMoves = (x.seenMoves || 0) + 1
                }
                x.totalBet += betPut || 0
                x.turn = false
            }
            else if (nextPlayerTurnId && String(x?.playerId) == String(nextPlayerTurnId)) {
                x.turn = true
            }
        })

        // FLIPPER: jo banda abhi pack hua, uski cards hi naye variable joker ban jaati hain.
        // null aaya to board waisa hi rehne do (neeche update aur emit dono skip ho jaate).
        let newJokers = null
        if (isFlipper && isPacked) {
            const packedPlayer = matchData?.playersData?.find(x => String(x?.playerId) === String(userId))
            newJokers = replaceVariableJokers(matchData?.jokerCards, packedPlayer?.cards)
            if (newJokers) matchData.jokerCards = newJokers
        }

        // ZHANDU: round key (movesRound) = sabse bada KHULA joker ka index.
        //   match start  -> movesRound 0 -> jokerCards[0] (J1) pehle hi khula.
        //   last active player ne khela (round poora) -> movesRound++ -> us index ka joker khol do.
        //     round 1 -> jokerCards[1] (J2), round 2 -> jokerCards[2] (J3).
        // Sirf tab jab 2+ active players bache hon (warna game waise hi khatam ho raha).
        let openedJoker = null
        let zhanduUpdate = {}
        if (matchData?.gameType === gameTypeConstant?.ZHANDU) {
            const stillActive = matchData.playersData.filter(x => !x?.isPacked && !x?.isAllIn)
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
        matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, turn: userId }, {
            // FOLD free hai -> pot na badhe (pehle fold pe bhi pot += amount ho raha tha =
            // phantom coins/inflation). Sirf actual bet/raise pe pot badhega.
            turn: nextPlayerTurnId, playersData: matchData?.playersData, $inc: { pot: isPacked ? 0 : betPut },
          //  currentBetAmount: amount,
            currentBetAmount:currentBet,
            // ...(disconnect ? { $addToSet: { exitPlayers: userId } } : {}),
            ...(matchData?.sideShow ? { sideShow: false } : {}),
            ...(!matchData?.raise && isRaisebet ? { raise: true } : {}),
            ...zhanduUpdate,
            ...(newJokers ? { jokerCards: newJokers } : {}),

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

        // FLIPPER: board flip hua -> sab ko naya board bhejo.
       // if (newJokers) this.emitJokerOpened(io, matchData, matchData?.jokerCards?.[0], userId)


        const index = checkIndex(matchData, userId)

        // Fold pe coins nahi ghate; warna jitna daala (betPut) utna ghata do.
        const selfCoin = userData?.coins - (isPacked ? 0 : betPut)
        let selfBet = matchData?.playersData.find(x => String(x?.playerId) == String(userId))
        selfBet = selfBet?.totalBet


        matchData.players.forEach((player) => {
            const data = {_id: matchData?._id, userId, index, isPacked, currentBetAmount: betAmount ||matchData?.currentBetAmount, pot: matchData?.pot, selfCoin:selfCoin, selfBet,isFlipper, jokerCards: matchData?.jokerCards}
            emitToUser(io, player?._id, socketEmit.successPlaceBet, data);
        });


        this.sendCommonEmitForWatcher(io, matchData, socketEmit.successPlaceBet, { _id: matchData?._id, userId, index, isPacked, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, selfCoin, selfBet,isFlipper,jokerCards: matchData?.jokerCards })

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
        // ===== FLIPPER ALL-IN (§4): normal betTurn nahi, FORCED side show =====
        // All-in karte hi turn aage nahi badhta — pehle left wale se show hota hai.
        // Aage ka turn allInSideShow khud schedule karta hai (chain khatam hone par).
        else if (isFlipper && isAllInMove) {
            await this.allInSideShow(io, matchData, userId)
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

            const previousWinnerSeatIndex = previousWinnerIndex(matchData, matchData?.previousWinner)

            // sab pack ho gaye -> akela bacha hua hi winner; uske cards bhi bhej do.
            const winnersCards = buildWinnersCards(matchData, [nextPlayerTurnId])
            const winnerCards = winnersCards[0]?.cards || []

            console.log("::::::::::::::::::player1:::::", player1,)

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.roundWinner, { _id: matchData?._id, winnerId: nextPlayerTurnId, winnerCards, winnersCards, player1, player2: {}, previousWinnerSeatIndex, nextRoundIn: NEXT_ROUND_SEC,selfCoin: player?.coins });
            });

            this.sendCommonEmitForWatcher(io, matchData, socketEmit.roundWinner, { _id: matchData?._id, winnerId: nextPlayerTurnId, winnerCards, winnersCards, player1, player2: {}, previousWinnerSeatIndex, nextRoundIn: NEXT_ROUND_SEC })


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
            matchSchema.model.findOne({ players: userId, start: true, end: false }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').populate('watchers', 'name socketId coins').lean()
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

         if (!alreadySeenCard) {
            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, "playersData.playerId": userId }, {
            $set: {
                "playersData.$.isSeen": true
            }
        }, { new: true }).populate('players', 'name socketId coins').lean()
        // seenCard ne playersData (isSeen) badla -> placeBet ka cache invalidate.
         await deleteMatch(matchData?._id)
     };

        console.log(":::::Seen cards::::::", cards)

        const index = checkIndex(matchData, userId)

        // ZHANDU: user ko apne cards ke saath, abhi KHULE jokers se banne wale BEST possible
        // hand ke resolved CARDS ka array bhejo (frontend sirf cards dikhata). All-in ho to
        // uske applicable jokers hi lagenge (getApplicableJokerValues), warna saare khule.
        let bestHand = []
        if ((matchData?.gameType === gameTypeConstant?.ZHANDU || matchData?.gameType === gameTypeConstant?.FLIPPER) && Array.isArray(cards) && cards.length) {
            const selfData = matchData?.playersData?.find(x => String(x?.playerId) === String(userId))
            const jokerVals = getApplicableJokerValues(matchData, selfData)
            bestHand = evaluateBestHandWithJoker(cards, jokerVals)?.usedCards
        }

        matchData.players.forEach((player) => {
            if (String(player?._id) == String(userId)) emitToUser(io, player?._id, socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index, cards, bestHand });
            else emitToUser(io, player?._id, socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index, cards: "" });
        });

       if(String(matchData?.turn)==String(userId)) await sendBetTurnEmit(io,userId,matchData,true)

    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    } finally {
        if (lockMatchId && lockToken) await releaseLock(lockMatchId, lockToken);
    }

}

module.exports.fetchBestHand = async (io, user, socketId, data = {}) => {

    try {

        const userId = user?._id
        const matchData = await matchSchema.model
            .findOne({ players: userId, gameType: { $in: [gameTypeConstant?.ZHANDU, gameTypeConstant?.FLIPPER] }, start: true,/* end: false */ })
            .sort({ createdAt: -1 })
            .lean()

       // if (!matchData) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "No active zhandu/flipper match found." });
        if (!matchData) return 

        const hasExited = (matchData?.exitPlayers || []).some(x => String(x) === String(userId))
        if (hasExited) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "You have exited this match." });

        const selfData = matchData?.playersData?.find(x => String(x?.playerId) === String(userId))
        const cards = selfData?.cards

        if (!selfData || !Array.isArray(cards) || !cards.length) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Cards are not distributed yet." });

        if (!selfData?.isSeen) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Please see your cards first." });

        const jokerValues = getApplicableJokerValues(matchData, selfData)

        // Jokers khaali ho (theoretically J1 hamesha khula hota) to ye normal best hand de dega.
        const best = evaluateBestHandWithJoker(cards, jokerValues)

        return emitToUser(io, userId, socketEmit.fetchBestHand, {
            _id: matchData?._id,
            roomId: matchData?.roomId,
            userId,
            index: checkIndex(matchData, userId),
            bestHand: best?.usedCards || [],
            handName: best?.name || null,
            handRank: best?.rank ?? null,
        });

    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
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
            // watchers bhi populate: show branch (roundWinner) aur resolveShowdown dono
            // sendCommonEmitForWatcher call karte hain — bina populate ke watchers sirf
            // ObjectId hote, `x?._id` undefined aata aur spectators ko kuch dikhta hi nahi.
            matchSchema.model.findOne({ start: true, end: false, turn: userId }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').populate('watchers', '_id name socketId coins').lean()
        ])

        if (!matchData || !userData) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Not your turn." });

        const otherPlayer = sideShowTurnManager(matchData?.playersData, userId)

        const totalActivePlayers = matchData?.playersData?.filter(x => !x?.isPacked && !x?.isAllIn) || [];
        if (totalActivePlayers?.length < 2) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Show not possible right now." });

        const show = totalActivePlayers?.length == 2 ? true : false

        if (!show) {

            if (matchData?.gameType == gameTypeConstant?.ZHANDU) {
                const allJokersOpen = (matchData?.jokerCards?.length || 0) > 0 && matchData.jokerCards.every(j => j?.opened)
                if (!allJokersOpen) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show allowed only after all 3 jokers are opened." });

                const requester = matchData?.playersData?.find(x => String(x?.playerId) === String(userId))
                if (!(requester?.seenMoves >= 1)) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show allowed only after you make a seen move." });
            }

            else if (matchData?.gameType == gameTypeConstant?.FLIPPER) {
                const allPlayersSeen = totalActivePlayers.every(x => x?.isSeen)
                if (!allPlayersSeen) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show allowed only after all players have seen their cards." });

                const requester = matchData?.playersData?.find(x => String(x?.playerId) === String(userId))
                if (!(requester?.seenMoves >= 1)) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show allowed only after you make a seen move." });
            }

            //For Side show
            // `|| {}` zaroori: ab sideShowTurnManager all-in players ko bhi skip karta hai,
            // to 3+ active hote hue bhi (baaki sab all-in) null aa sakta hai -> destructure crash.
            const { isSeen, playerId } = otherPlayer || {}
            if (!isSeen || !playerId) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show not possible." });

            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, sideShow: false }, { sideShow: true, sideShowUser: playerId }).populate('players', 'name socketId coins').lean()
            if (!matchData) return;

            // sideShow flag set hua -> cache invalidate.
            await deleteMatch(matchData?._id)

            const from = matchData.players.find(x => String(x?._id) == String(userId)) || {}
            const to = matchData.players.find(x => String(x?._id) == String(playerId)) || {}
            from["index"] = matchData?.seatPosition.find(x => String(x?.playerId) == String(userId))?.index ?? -1
            to["index"] = matchData?.seatPosition.find(x => String(x?.playerId) == String(playerId))?.index ?? -1

        
            const remainingMs = await getAutoPackRemainingMs(matchData?._id)
            const sideShowTimer = remainingMs === null ? 10 : Math.max(0, Math.floor(remainingMs / 1000))

            const timeoutMs = remainingMs === null ? 10000 : Math.max(0, remainingMs)
            await cancelAutoPack(matchData?._id)
            await scheduleFlow("sideShowTimeout", { matchId: String(matchData?._id), requesterId: String(userId), responderId: String(playerId) }, timeoutMs)

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.sideShowRequest, { _id: matchData?._id, from, to, timer: sideShowTimer });
            });
        }
        else if (show) {
            //for final show
            // const totalPlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
            // if (totalPlayers?.length != 2) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Show not possible right now." });

            // ALL-IN CONTENDER GUARD: `totalActivePlayers` sirf BETTORS hain (all-in filtered),
            // par pot me paisa all-in walon ka bhi laga hua hai. Jaise A, B bet kar rahe hon
            // aur X all-in ho -> bettors 2 -> yahan tak pahunch jaata, aur neeche ka seedha
            // 2-way compare + `creditWinnerPot(pura pot)` X ko comparison se hi uda deta:
            // uska saara paisa A/B me se kisi ek ko chala jaata, jabki all-in karke usne
            // apna claim khareeda tha.
            //
            // Aisi soorat me showdown resolveShowdown ko do — wo buildSidePots se layer-wise
            // pot banata (all-in banda utna hi jeetta jitna usne daala, upar ka paisa bade
            // bettor ko wapas), sab contenders ke cards reveal karta, aur har all-in player
            // ke FREEZE kiye hue jokers (appliedJokers) ke saath hand banata hai.
            // Wahi apna poora tail bhi sambhalta hai: cancelAutoPack, end:true, pot credit,
            // cache delete, startNextRound — isliye yahan se seedha return.
            const contenders = matchData?.playersData?.filter(x => !x?.isPacked) || []
            if (contenders.length > totalActivePlayers.length) {
                await resolveShowdown(io, matchData)
                return
            }

            // ZHANDU Section 7: 2-player SHOW pe agar koi joker abhi BAND hai to conditionally
            // kholo. totalActivePlayers ko x.index se sort karo — agar show maangne wala
            // (userId) is sorted array ke LAST (sabse bade index = button) me hai to target
            // uske RIGHT (chhota index) hota -> agla band joker KHULEGA (dono pe apply).
            // Warna (requester chhota index) target = button (left) -> band. Sirf agla ek joker.
            let showOpenedJoker = null
            if (matchData?.gameType == gameTypeConstant?.ZHANDU) {
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
                if (matchData?.gameType == gameTypeConstant?.ZHANDU) {
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

            const previousWinnerSeatIndex = previousWinnerIndex(matchData, matchData?.previousWinner)

            await cancelAutoPack(matchData?._id);

            // GUARD: `end: false` zaroori hai (baaki dono round-end paths me pehle se hai).
            // Iske bina late/duplicate show response already-ended match ko dobara end karta,
            // pot DOBARA credit hota, aur `startNextRound` dobara chal ke usi roomId ke liye
            // ek aur match + ek aur `startNext` job bana deta -> do matchStart, round jaldi
            // restart hota dikhta. Null aaya matlab round pehle hi khatam -> chup-chaap return.
            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, end: false }, { winner: winnerId, end: true, ...(splitAmong ? { draw: true } : {}), ...(showOpenedJoker ? { jokerCards: matchData.jokerCards, movesRound: matchData.movesRound } : {}) }, { new: true }).populate('players', 'name socketId coins').populate('watchers', '_id name socketId coins').lean()
            if (!matchData) return

          
            // DRAW (zhandu split) me single winner nahi hota -> splitAmong ke sabke cards.
            const winnersCards = buildWinnersCards(matchData, splitAmong && splitAmong.length ? splitAmong : [winnerId])
            const winnerCards = winnersCards.find(x => String(x?.playerId) === String(winnerId))?.cards || []

            const showLooserId = splitAmong? "123xyz" : (totalActivePlayers.find(x => String(x?.playerId) !== String(winnerId))?.playerId || "123xyz")
            const sideShowWinnerPayload = { _id: matchData?._id, player1, player2, winnerId, looserId: showLooserId, isDraw, isFinalShow: true }

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.sideShowWinner, sideShowWinnerPayload);
            });
            this.sendCommonEmitForWatcher(io, matchData, socketEmit.sideShowWinner, sideShowWinnerPayload)

            matchData.players.forEach((player) => {
                emitToUser(io, player?._id, socketEmit.roundWinner, { _id: matchData?._id, player1, player2, winnerId, winnerCards, winnersCards, isDraw, splitAmong, previousWinnerSeatIndex, nextRoundIn: NEXT_ROUND_SEC ,selfCoin: player?.coins});
            });
            this.sendCommonEmitForWatcher(io, matchData, socketEmit.roundWinner, { _id: matchData?._id, player1, player2, winnerId, winnerCards, winnersCards, isDraw, splitAmong, previousWinnerSeatIndex, nextRoundIn: NEXT_ROUND_SEC })

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

// SIDE SHOW KA ANT — reject aur timeout, dono ka natija bilkul ek hai: show khatam aur
// requester ki CHAAL lag jaati hai. Pehle ye code DO jagah copy tha (reject branch +
// _flowSideShowTimeout) — ek jagah multiplier badalta aur doosri chhoot jaati, aisa khatra tha.
//
// Ye function TAALA NAHI LETA — placeBetCore jaisa hi, bulane wale ka taala maanta hai:
//   respondToSideShow (reject) -> taala pehle se hai   -> seedha call
//   _flowSideShowTimeout       -> pehle khud taala leta -> phir call
const finishSideShow = async (io, matchData, requesterId, responderId) => {

    // Client ke liye reject aur timeout me koi farq nahi — dono pe wahi popup band hota hai.
    matchData.players.forEach((player) => {
        emitToUser(io, player?._id, socketEmit.rejectSideShow, { _id: matchData?._id, from: responderId, to: requesterId });
    });

    // Requester ki minimum chaal — seen / previousWinner ka wahi multiplier.
    const seenPlayer = matchData?.playersData?.find(x => String(x?.playerId) === String(requesterId))?.isSeen
    const previousWinner = String(matchData?.previousWinner) === String(requesterId)

    let currentBetAmount = matchData?.currentBetAmount
    if (seenPlayer && previousWinner) currentBetAmount = currentBetAmount * 4
    else if (seenPlayer || previousWinner) currentBetAmount = currentBetAmount * 2

    // SAFETY: itne coins hi na bache to placeBetCore "Insufficient coins" pe return kar deta —
    // aur auto-pack to side show request pe cancel ho chuka hai, matlab turn HAMESHA ke liye
    // atak jaata. Aise me purana wala hi natija: PACK.
    // (Zhandu me kam coins = ALL-IN, jo placeBetCore khud sambhal leta hai -> wahan pack nahi.)
    const isZhandu = matchData?.gameType === gameTypeConstant?.ZHANDU
    const requesterUser = await userSchema.model.findOne({ _id: requesterId }).select("coins").lean()

    // `betAmount` DENA ZAROORI hai — placeBetCore ka pehla guard (!isPacked && !betAmount)
    // warna wo turant return kar deta, chaal lagti hi nahi aur turn wahin atak jaata.
    if (!isZhandu && Number(requesterUser?.coins || 0) < Number(currentBetAmount)) {
        await placeBetCore(io, requesterId, null, { isPacked: true, betAmount: 0 }, matchData?._id);
    } else {
        await placeBetCore(io, requesterId, null, { isPacked: false, betAmount: currentBetAmount }, matchData?._id);
    }
}


module.exports.respondToSideShow = async (io, user, socketId, data = {}) => {

    // Lock ke variables — finally me release ke liye try ke bahar.
    let lockMatchId = null;
    let lockToken = null;

    try {

        const { accept = false } = data

        let userId = user?._id

        console.log("::::::::::::::::::! accept side show request::::::! ", data)

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


        // BETTORS hi ginte hain (packed + all-in dono bahar) — ye `sideShow()` ka theek ulta
        // mirror hai: wahan bettors == 2 hote hi FINAL SHOW hota hai, side show nahi. To side
        // show ka jawab bhi tabhi valid jab 3+ bettor ho. All-in wale gine nahi jaate: unka
        // koi betting decision bacha hi nahi aur wo side show ke target bhi nahi ban sakte.
        const totalPlayers = matchData?.playersData?.filter(x => !x?.isPacked && !x?.isAllIn) || [];
        if (totalPlayers?.length < 3) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "side Show not possible right now." });

       // await cancelAutoPack(matchData?._id);

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
              const data= p1Np2Id.includes(String(player?._id)) ?{ player1, player2}:{}
              emitToUser(io, player?._id, socketEmit.sideShowWinner, { ...data,_id: matchData?._id, winnerId: resolvedWinnerId, looserId, isDraw: String(winner) === "DRAW" })
            });

            let nextPlayerTurnId = turnManager(matchData?.playersData, otherPlayerId,)

            if (!nextPlayerTurnId) return


            // SIDE SHOW ka CHAAL: accept hone par bhi requester (otherPlayerId = jisne show
            // maanga, turn bhi usi ka hai) ka bet lagega. Pehle sirf REJECT branch me
            // placeBetCore charge karta tha -> accept pe requester ko MUFT ka turn mil jaata
            // tha, aur pot ka size opponent ke accept/reject pe depend karta tha.
            const requesterUser = await userSchema.model.findOne({ _id: otherPlayerId }).select("coins").lean()
            // Pot invariant (economy net-zero): pot me utna hi jaaye jitna sach me kaata gaya.
            // Coins kam pade to jitne bache hain utne hi — coins kabhi negative na hon.
            const requesterBet = Math.min(Number(matchData?.currentBetAmount) || 0, Number(requesterUser?.coins) || 0)

            matchData.playersData.map((x) => {
                if (String(x?.playerId) == String(otherPlayerId) && requesterBet > 0) {
                    x.totalBet += requesterBet
                    // seen player ka move count — zhandu side-show eligibility isi pe chalti hai.
                    if (x?.isSeen) x.seenMoves = (x.seenMoves || 0) + 1
                }
            })

            matchData.playersData.map((x) => {
                if (String(x?.playerId) == String(looserId)) {
                    x.isPacked = true
                    x.turn = false
                }
            })

            // FLIPPER: side show haar ke pack hone wala bhi fold hi hai — uski cards se
            // variable joker badal do.
            let newJokers = null
            if (matchData?.gameType === gameTypeConstant?.FLIPPER) {
                const looser = matchData?.playersData?.find(x => String(x?.playerId) === String(looserId))
                newJokers = replaceVariableJokers(matchData?.jokerCards, looser?.cards)
                if (newJokers) matchData.jokerCards = newJokers
            }
            // isPacked emit userId (responder) ke liye hai -> kya responder khud pack hua?
            const isPacked = String(looserId) === String(userId)

            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, {
                turn: nextPlayerTurnId, playersData: matchData?.playersData,
                ...(requesterBet > 0 ? { $inc: { pot: requesterBet } } : {}),
                ...(newJokers ? { jokerCards: newJokers } : {}),
            }, { new: true }).populate('players', 'name socketId coins').lean()

            // FLIPPER: board flip hua -> sab ko naya board bhejo (update ke BAAD, taaki
            // matchData me latest jokerCards ho).
            if (newJokers) this.emitJokerOpened(io, matchData, matchData?.jokerCards?.[0], looserId)

            // BET DEBIT requester se — pot me jitna gaya, coins se utna hi kato.
            if (requesterBet > 0) {
                await userSchema.model.updateOne({ _id: otherPlayerId }, { $inc: { coins: -requesterBet } })
            }

            // turn/playersData badla -> cache invalidate (agla placeBet fresh padhe).
            await deleteMatch(matchData?._id)


            const index = checkIndex(matchData, userId)

            const selfCoin = user?.coins
            let selfBet = matchData?.playersData.find(x => String(x?.playerId) == String(userId))
            selfBet = selfBet?.totalBet

            // Requester ka chaal bhi board pe dikhna chahiye (coins ghate + pot badha),
            // warna client pe sirf looser pack hota dikhta aur pot silently badal jaata.
            if (requesterBet > 0) {
                const requesterIndex = checkIndex(matchData, otherPlayerId)
                const requesterSelfBet = matchData?.playersData.find(x => String(x?.playerId) == String(otherPlayerId))?.totalBet
                const requesterSelfCoin = Number(requesterUser?.coins || 0) - requesterBet
                matchData.players.forEach((player) => {
                    emitToUser(io, player?._id, socketEmit.successPlaceBet, { _id: matchData?._id, userId: otherPlayerId, index: requesterIndex, isPacked: String(looserId) === String(otherPlayerId), currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, selfCoin: requesterSelfCoin, selfBet: requesterSelfBet });
                });
            }

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

            // Taala pehle se yahin held hai -> helper seedha call (wo khud taala nahi leta).
            // otherPlayerId = matchData.turn = REQUESTER, userId = jisne reject kiya.
            await finishSideShow(io, matchData, otherPlayerId, userId)
        }




    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    } finally {
        if (lockMatchId && lockToken) await releaseLock(lockMatchId, lockToken);
    }
}


// ==================== FLIPPER: ALL-IN FORCED SIDE SHOW (PDF §4) ====================
// Flipper me all-in move apne aap left-hand player ke saath side show ban jaata hai.
// Ye asli side show (`sideShow` / `respondToSideShow`) se JAANBOOJH KE alag rakha gaya hai:
//   - koi request nahi, koi accept/reject nahi, koi 10s timer nahi -> server khud compare karta hai
//   - dono ko cards dekhni PADTI hain, blind ho to bhi -> dono isSeen ho jaate hain
// Purane side show ka ek line bhi nahi chheda. Kal ko §4 ka koi rule badla to sirf yahi
// function badlega — isliye saara §4 ka logic yahin ek jagah rakha hai.
//
// LOCK: ye `placeBetCore` ke andar se call hota hai jo pehle se match lock leke baitha hai.
// Yahan lock DOBARA mat lena — apne aap se deadlock ho jayega (CLAUDE.md wali discipline).
//
// Abhi ek LINK handle hota hai (all-in vs left wala). Chain — left wala haara to agle left
// se phir show — agla step hai; neeche TODO pe marker laga hai.
module.exports.allInSideShow = async (io, matchData, allInPlayerId) => {
    try {
        const playersData = matchData?.playersData || []

        // Jo abhi bhi hand me hain. Sirf PACKED bahar — all-in wale andar hi rehte hain
        // (khud all-in player bhi, warna wo apni hi list se filter ho jaata aur target hi
        //  na milta). All-in banda ab bet nahi kar sakta, par pot ka daavedar to hai hi.
        const inHand = playersData.filter(x => !x?.isPacked)
        const meIdx = inHand.findIndex(x => String(x?.playerId) === String(allInPlayerId))

        // Koi saamne wala hi nahi bacha -> show ka sawaal hi nahi, seedha showdown.
        if (meIdx === -1 || inHand.length < 2) return await resolveShowdown(io, matchData)

        // "Left hand side" ka matlab wahi rakha hai jo existing side show me hai
        // (`sideShowTurnManager` -> circular PREVIOUS player), taaki table pe do alag-alag
        // concept na banein. Chain me bhi hum isi direction me aage badhenge.
        const opponent = inHand[(meIdx - 1 + inHand.length) % inHand.length]
        const me = inHand[meIdx]

        // §4 (decision D6): forced show me dono ko cards dekhni PADTI hain -> isSeen true.
        // `seenMoves` JAANBOOJH KE nahi badhaya — wo "seen hoke ek chaal kheli" ginta hai,
        // aur usi pe §3 ki side-show eligibility tiki hai. Dekh lene se haq nahi mil jaata.
        playersData.forEach(x => {
            if (String(x?.playerId) === String(me?.playerId) || String(x?.playerId) === String(opponent?.playerId)) {
                x.isSeen = true
            }
        })

        // Compare — flipper ke chaaron joker wild ki tarah lagte hain (koi freeze nahi).
        const { player1, player2, winner } = compareResult(me, opponent, {
            gameType: matchData?.gameType,
            jokerValue: matchData?.jokerCard?.cardValue,
            jokerValues: getOpenedJokerValues(matchData)
        })

        // DRAW (decision D1): all-in wala haarta. Wajah — codebase me side show tie ka rule
        // pehle se yahi hai (jisne show maanga wo haarta), aur forced show ka "maangne wala"
        // effectively all-in player hi hai. Isse chain bhi pakke tor pe khatam ho jaati hai.
        const looserId = String(winner) === "DRAW"
            ? me?.playerId
            : (String(winner) === String(me?.playerId) ? opponent?.playerId : me?.playerId)
        const winnerId = String(looserId) === String(me?.playerId) ? opponent?.playerId : me?.playerId
        const allInLost = String(looserId) === String(me?.playerId)

        // Haarne wala fold. Decision D5: alag flag nahi, `isPacked` hi — poora system
        // (buildSidePots ki eligibility, turnManager, active count) isi pe key karta hai.
        playersData.forEach(x => {
            if (String(x?.playerId) === String(looserId)) { x.isPacked = true; x.turn = false }
        })

        // §2: fold hua matlab uski cards hi naye variable joker. Fixed wala nahi badalta.
        const looser = playersData.find(x => String(x?.playerId) === String(looserId))
        const newJokers = replaceVariableJokers(matchData?.jokerCards, looser?.cards)

        matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, end: false }, {
            playersData,
            ...(newJokers ? { jokerCards: newJokers } : {}),
        }, { new: true }).populate('players', 'name socketId coins').populate('watchers', '_id name socketId coins').lean()

        // Round beech me hi khatam ho gaya (late/duplicate call) -> chup-chaap nikal jao.
        if (!matchData) return
        await setMatch(matchData)

        // Cards sirf un DO ko jo show me the — baaki table ko sirf natija. Yahi rule
        // `respondToSideShow` bhi follow karta hai, to client ko naya case nahi milega.
        const result = { _id: matchData?._id, winnerId, looserId, isDraw: String(winner) === "DRAW", isForced: true, reason: "allInSideShow" }
        const shownTo = [String(me?.playerId), String(opponent?.playerId)]
        matchData.players.forEach((player) => {
            const cards = shownTo.includes(String(player?._id)) ? { player1, player2 } : {}
            emitToUser(io, player?._id, socketEmit.sideShowWinner, { ...cards, ...result })
        })
        this.sendCommonEmitForWatcher(io, matchData, socketEmit.sideShowWinner, result)

        // Board flip — update ke BAAD bhejo taaki matchData me naya board ho.
        if (newJokers) this.emitJokerOpened(io, matchData, matchData?.jokerCards?.[0], looserId)

        // ===== Ab aage kya =====
        const stillInHand = matchData.playersData.filter(x => !x?.isPacked)

        // Ek hi bacha -> round wahin khatam. resolveShowdown side pots ke saath pot baant
        // deta hai (1 eligible ho to bina compare ke wahi winner).
        if (stillInHand.length <= 1) return await resolveShowdown(io, matchData)

        // TODO (agla step — chain): agar all-in wala JEETA hai (allInLost === false) to §4
        // kehta hai process khatam nahi hota — uska hand agle left active player se phir
        // forced show me jaayega, aur tab tak jab tak wo haare ya sirf 2 bachein.
        // Filhaal chain nahi hai: dono soorat me betting normal resume ho jaati hai.
        if (!allInLost) console.log(":::::flipper all-in chain pending (left wala haara):::::", { matchId: String(matchData?._id), allInPlayerId: String(allInPlayerId) })

        // Betting resume. Turn `placeBetCore` pehle hi agle bettor pe set kar chuka hai;
        // par agar wahi banda abhi show me haar ke pack ho gaya to uske aage wale ko do.
        let nextTurnId = matchData?.turn
        const turnPd = matchData.playersData.find(x => String(x?.playerId) === String(nextTurnId))
        if (!turnPd || turnPd?.isPacked || turnPd?.isAllIn) nextTurnId = nextBettorFrom(matchData.playersData, looserId)

        // Koi bet karne wala hi nahi bacha (sab all-in) -> showdown.
        if (!nextTurnId) return await resolveShowdown(io, matchData)

        await matchSchema.model.updateOne({ _id: matchData?._id, end: false }, { turn: nextTurnId })
        await deleteMatch(matchData?._id)   // turn badla -> cache stale, agla read fresh ho
        await scheduleFlow("betTurn", { matchId: String(matchData?._id), playerTurnId: String(nextTurnId) }, FLIPPER_CHAIN_MS)

    } catch (error) {
        console.log("allInSideShow error =>", error.message)
    }
}

// Agla BETTOR dhoondo, poori seat-order list pe chal ke. `turnManager` yahan kaam nahi
// karta kyunki wo reference player ko bhi filtered list me dhoondta hai — aur hamara
// reference (haara hua banda) tab tak pack ho chuka hota hai -> null milta.
const nextBettorFrom = (playersData, fromPlayerId) => {
    const list = playersData || []
    const i = list.findIndex(x => String(x?.playerId) === String(fromPlayerId))
    if (i === -1) return null
    for (let step = 1; step <= list.length; step++) {
        const p = list[(i + step) % list.length]
        if (p && !p?.isPacked && !p?.isAllIn) return p?.playerId
    }
    return null
}


// SIDE SHOW TIMEOUT (BullMQ `sideShowTimeout` job) — requester ne side show maanga aur
// responder ne bache hue time me kuch jawab hi nahi diya.
// Natija reject se alag hai hi nahi: side show khatam, aur requester ki CHAAL lag jaati hai.
// Har doosre raste (accept / reject / requester ne khud chaal-pack kar liya) me `sideShow`
// flag clear ho chuka hota hai ya turn aage badh chuka hota hai -> ye job LATE hai, no-op.
// Isliye job cancel karne ki zaroorat nahi (baaki flow jobs jaisa hi validate-on-fire).
module.exports._flowSideShowTimeout = async (io, matchId, requesterId, responderId) => {

    let lockToken = null;

    try {
        if (!matchId || !requesterId) return

        // --- LOCK: placeBetCore bina taale ke chalta hai (caller ka taala maanta hai) ---
        lockToken = await acquireLock(matchId)
        if (!lockToken) return

        // teeno condition abhi bhi wahi hon tabhi timeout valid hai:
        //   sideShow: true      -> responder ne accept/reject nahi kiya
        //   sideShowUser        -> usi responder ka jawab pending hai
        //   turn: requesterId   -> requester ne khud koi chaal/pack nahi kiya
        // (filter fail = koi na koi pehle act kar chuka -> chupchaap nikal jao.)
        let matchData = await matchSchema.model.findOneAndUpdate(
            { _id: matchId, start: true, end: false, sideShow: true, sideShowUser: responderId, turn: requesterId },
            { sideShow: false, sideShowUser: null }
        ).populate('players', 'name socketId coins').lean()
        if (!matchData) return

        // sideShow flag clear hua -> cache invalidate (placeBetCore fresh padhe).
        await deleteMatch(matchData?._id)

        // Taala upar le liya hai -> helper seedha call (wo khud taala nahi leta).
        await finishSideShow(io, matchData, requesterId, responderId)

       
    } catch (error) {
        console.log(error);
    } finally {
        if (lockToken) await releaseLock(matchId, lockToken);
    }
}


module.exports.startNextRound = async (io, matchData) => {
    try {
        let exitPlayers = matchData.exitPlayers?.map(x => String(x))
        let players = matchData.players.filter(x => {
            if (x?._id && !exitPlayers.includes(String(x?._id))) return String(x?._id)
        })

        // Agle round me sirf wahi baithega jiske paas boot ka DUGNA coins ho (joinRoomNew wala
        // hi rule). Coins DB se fresh — matchData ka snapshot pot credit se pehle ka hai.
        const minCoins = (matchData?.entryAmount || 0)
        const coinsList = await userSchema.model.find({ _id: { $in: players.map(x => x?._id) },sessionClosed:false }).lean()
        const activeIds = new Set(coinsList.map(u => String(u?._id)))
        const coinsMap = new Map(coinsList.map(u => [String(u?._id), u?.coins || 0]))

        const closedPlayers = players.filter(x => !activeIds.has(String(x?._id)))
        players = players.filter(x => activeIds.has(String(x?._id)))

        // Jinke paas coins nahi wo watcher ban jaayenge.
        const brokePlayers = players.filter(x => (coinsMap.get(String(x?._id)) || 0) < minCoins)
        players = players.filter(x => (coinsMap.get(String(x?._id)) || 0) >= minCoins)

        // Seat bhi chhod do, warna broke player ka seat blocked padha rehta hai.
        const seatedIds = players.map(x => String(x?._id))

        let seatPosition = matchData.seatPosition.filter(x => {
            //We can change this in  future only new player save the player array
            if (x?.playerId && !exitPlayers.includes(String(x?.playerId)) && seatedIds.includes(String(x?.playerId))) return x
        })

        // Purane watchers + naye broke players (dedupe).
        const watchers = [...new Set([
            ...(matchData?.watchers || []).map(x => String(x?._id || x)),
            ...brokePlayers.map(x => String(x?._id)),
        ])];

        // Jisko coins ya session-close ki wajah se bahar nikala uska selfExit emit bhi bhejo —
        // warna client agle matchStart (30s) tak use seat pe hi dikhata rehta. Index PURANE
        // match se lo, naye match me uski seat hai hi nahi.
        [...brokePlayers, ...closedPlayers].forEach((x) => {
            const payload = { _id: matchData?._id, roomId: matchData?.roomId, userId: x?._id, index: checkIndex(matchData, x?._id) }
            matchData.players.forEach((player) => emitToUser(io, player?._id, socketEmit.selfExitSuccess, payload))
            this.sendCommonEmitForWatcher(io, matchData, socketEmit.selfExitSuccess, payload)
        })


        let [newMatch] = await Promise.all([
            matchSchema.model.create({ players, roomId: matchData?.roomId, seatPosition, waitForNextRount: true, watchers, gameType: matchData?.gameType,variation:matchData?.variation , previousWinner: matchData?.winner,bootAmount:matchData?.bootAmount,entryAmount:matchData?.entryAmount,
                betLimit:matchData?.betLimit,roomName:matchData?.roomName
            })
        ])
        newMatch = newMatch.toObject()

        // NEXT_ROUND_MS baad agla round shuru — BullMQ flow job (reload-safe; pehle setTimeout tha).
        await scheduleFlow("startNext", { matchId: String(newMatch?._id) }, NEXT_ROUND_MS)


    } catch (error) {
        console.log(error);
    }
}


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
        const betTurnDelay =match?.players.length?(match.players.length*4)*1000: 20000

        console.log(":::::::betTurnDelay+++++++++++:::::::",betTurnDelay)
        // ZHANDU: J1 (first joker) ka jokerOpened emit betTurn se 2s PEHLE bhejo, taaki client
        // turn shuru hone se pehle joker khulta dikha sake. (J2/J3 to placeBet me khulte hi hain.)
        // FLIPPER: chaaron joker pehle se khule hain, par client ko board dikhane ke liye
        // wahi 2s-pehle wala reveal emit chahiye -> same job reuse (handler dono ko handle karta).
        if (match?.gameType == gameTypeConstant?.ZHANDU || match?.gameType == gameTypeConstant?.FLIPPER) {
            await scheduleFlow("firstJoker", { matchId: String(match?._id) }, Math.max(0, betTurnDelay - 2000))
        }

        // betTurnDelay baad pehla betTurn (current turn player).
        await scheduleFlow("betTurn", { matchId: String(match?._id), playerTurnId: String(match?.turn) }, betTurnDelay)
    } catch (e) {
        console.log("_flowDealCards error =>", e.message)
    }
}

// Board pe joker badla -> sab players + watchers ko batao.
// `joker` = wo ek joker jo abhi khula (zhandu isi ko animate karta hai).
// `foldedBy` sirf FLIPPER bhejta hai — kis bande ke fold se board flip hua.
// jokerCards hamesha poora board hota hai, to flipper client wahi se chaaron padh leta hai.
module.exports.emitJokerOpened = (io, match, joker, foldedBy = null) => {
    if (!match || !joker) return

    const data = { jokerCards: match?.jokerCards, joker, movesRound: match?.movesRound, foldedBy }

    match.players.forEach((player) => {
        emitToUser(io, player?._id, socketEmit.jokerOpened, { _id: match?._id, ...data })
    })
    module.exports.sendCommonEmitForWatcher(io, match, socketEmit.jokerOpened, data)
}

module.exports._flowFirstJoker = async (io, matchId) => {
    try {
        const match = await getMatch(matchId, { populate: true })
        if (!match || match.end || !match.start) return
        const j1 = match?.jokerCards?.[0]
        if (!j1 || !j1.opened) return

        // Flipper me chaaron joker khule hote hain, par emit ek hi jaata hai — payload ka
        // jokerCards poora board rakhta hai, to client wahi se saare joker dikha deta hai.
        module.exports.emitJokerOpened(io, match, j1)
    } catch (e) {
        console.log("_flowFirstJoker error =>", e.message)
    }
}

module.exports._flowStartNext = async (io, matchId) => {
    try {
        const updateMatch = await matchSchema.model.findOneAndUpdate({ _id: matchId }, { waitForNextRount: false }).lean()
        console.log(`[nextRound] fired match=${matchId} @${new Date().toISOString()}`)
        if (updateMatch && updateMatch.players.length >= gameConfig?.minPlayer) module.exports.startMatch(io, updateMatch)
    } catch (e) {
        console.log("_flowStartNext error =>", e.message)
    }
}

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


module.exports.selfExit = async (io, user, socketId, disconnect = false,data = {}) => {
    console.log(":::: Self Exit :::: ",user?.name,user?._id,disconnect);

    const {isLobby}=data
    // socketId filter jaan bujh ke: purane socket ka late disconnect naye connection ko na maare.
    const checkUser= disconnect?await userSchema.model.findOneAndUpdate({ _id: user?._id, socketId }, { socketId: null, disconnect: moment.utc().toDate() }).lean():await userSchema.model.findOne({ _id: user?._id, socketId }).lean()

    if(!checkUser) return
    let currentMatch = await matchSchema.model.findOne({ players: user?._id, end: false })
        .sort({ createdAt: -1 })
        .populate('players', '_id name socketId coins')
        .populate('watchers', '_id name socketId coins')
        .lean()

    const exitIndex = currentMatch ? checkIndex(currentMatch, user?._id) : -1

    
        await Promise.all([                       
        matchSchema.model.updateMany({ players: user?._id, start: true, end: false }, {
            $addToSet: { exitPlayers: user?._id },
        }),
        matchSchema.model.updateMany({ players: user?._id, start: false, end: false }, {
            $pull: { players: user?._id, seatPosition: { playerId: user._id } }
        }),
        //  matchSchema.model.updateMany({ previousWinner: user?._id, start: false, end: false }, {
        //     previousWinner:null
        // }),
        matchSchema.model.updateMany({ watchers: user?._id }, {
            $pull: { watchers: user?._id },
        }),
    ])

        // SESSION_CLOSE_MS baad dekhenge — tab tak wapas nahi aaya to session close.
    if(disconnect && !checkUser?.testUser){
        scheduleFlow("closeSession", { userId: String(user?._id) }, SESSION_CLOSE_MS)
        // notifyResult(checkUser)
    }

    if (currentMatch) {

        const previousWinnerSeatIndex = previousWinnerIndex(currentMatch, currentMatch?.previousWinner)
        const payload = {
            _id: currentMatch?._id,
            roomId: currentMatch?.roomId,
            userId: user?._id,
            index: exitIndex,
            previousWinnerSeatIndex:exitIndex==previousWinnerSeatIndex?-1:previousWinnerSeatIndex,
            isLobby,
        }

        currentMatch.players.forEach((player) => {
            payload.selfUser = String(player?._id) === String(checkUser?._id)
            if(payload.selfUser) emitToUser(io, player?._id, socketEmit.selfExitSuccess, payload)
        })
       // payload.selfUser = false
       // this.sendCommonEmitForWatcher(io, currentMatch, socketEmit.selfExitSuccess, payload)
    }
    else if(!disconnect){
        emitToUser(io, user?._id, socketEmit.selfExitSuccess, { _id: "_", roomId: "_", userId: user?._id, index: -1,selfUser:true,isLobby })
    }

    return;

};

module.exports._flowCloseSession = async (userId) => {
    try {
        
        const cutoff = moment.utc().subtract(SESSION_CLOSE_MS, 'milliseconds').toDate()

        // const inLiveMatch = await matchSchema.model.findOne({ players: userId, start: true, end: false })
        // if (inLiveMatch) return

        const closedUser = await userSchema.model.findOneAndUpdate(
            { _id: userId, sessionActive:true,sessionClosed: false, disconnect: { $ne: null, $lte: cutoff } },
            { sessionClosed: true },
            { new: true }
        ).lean()

        // Close hua hi nahi (banda wapas aa gaya, ya pehle se hi closed tha) -> archive bhi nahi.
        if (!closedUser) return

        // _id wahi user ka rakha hai -> ek session = ek hi doc. Job dobara fire ho ya
        // retry ho to overwrite hoga, naya duplicate doc nahi banega.
        await gameSessionSchema.model.updateOne(
            { _id: closedUser._id },
            {
                userId: closedUser.userId,
                name: closedUser.name,
                callbackUrl: closedUser.callbackUrl,
                currency: closedUser.currency,
                sessionToken: closedUser.sessionToken,
                startAmount: closedUser.amount,
                // finalCoins / netResult yaha nahi bharte — banda disconnect ke baad bhi us
                // match ka pot jeet sakta hai. Settle worker fresh coins se bharega.
                launchedAt: closedUser.createdAt,
                closedAt: moment.utc().toDate(),
                sendCallback:closedUser?.sendCallback
            },
            { upsert: true }
        )

        await notifyResult(closedUser)
    } catch (error) {
        console.log(":::: close session error ::::", error?.message)
    }
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
    console.log(":::: roomList::::::::::::rommList :::: ",data);
    try{

        const {gameType } = data

    const freshUser = await userSchema.model.findOne({ _id: user?._id }).lean()
      
    const selfCoin = freshUser?.coins ?? user?.coins ?? 0;

    if(!gameType){
        io.to(socketId).emit(socketEmit.gameList, { message: "Fetch Room List success", list:roomList, selfCoin });
        return io.to(socketId).emit(socketEmit.gameList, { message: "Fetch Room List success", list:roomList, selfCoin });
    }


    if (!Object.values(gameTypeConstant).includes(gameType)) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Invalid game type." });

    const list = await matchSchema.model.aggregate([
        {
            $match: {
                _id:{$ne:null},
                gameType:gameType,
                end: false
            }
        },
        {
            $sort:{
                entryAmount:1,
                createdAt:-1,
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
               // entryCoins:"$bootAmount",
                roomName: 1,
                variation: 1,
                gameType: 1,
                bootAmount:1,
                entryAmount:1
            }
        }
    ])


    return io.to(socketId).emit(socketEmit.fetchLobbyList, { message: "Fetch Room List success", list, selfCoin });
    }
    catch (error) { 
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });    
    }


};


module.exports.watchRoom = async (io, user, socketId, data = {}) => {
    console.log(":::: roomList::::::::::::rommList :::: ");
    try {

        const { roomId } = data

        if (!roomId) return;

        const [matchData,userdata] = await Promise.all([
            matchSchema.model.findOneAndUpdate({ roomId }, { $addToSet: { watchers: user?._id } }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean(),
            userSchema.model.findOne({ _id: user?._id }).lean()
        ]);

        if(!matchData ) return io.to(socketId).emit(socketEmit.errorLog, { message: "Invalid match id ." });
        // watcher add hua -> cache invalidate (cached watchers refresh ho).
        await deleteMatch(matchData?._id)

        matchData.players.forEach((player) => {
            player['index'] = checkIndex(matchData, player?._id)
        })

        const players= matchData.players.filter(x => !matchData?.exitPlayers.map(x=>String(x))?.includes(String(x?._id)))
        
        const payload = {
            _id: matchData?._id,
            turn: matchData?.turn,
            players: players,
            timer: 10,
            roomId: matchData?.roomId,
            previousWinnerSeatIndex : previousWinnerIndex(matchData, matchData?.previousWinner),
            gameType:matchData?.gameType,
            jokerCards: matchData?.jokerCards.filter(x => x?.opened)?.map(x => x.card),
            selfCoin: userdata?.coins,
        }

        console.log(":::::::::::::::::::>>.watchy room ::::::::::",payload?.jokerCards)


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

        // Pehle sirf PADHO. Seat tabhi denge jab coins check pass ho jaye — warna
        // findOneAndUpdate banda ko add kar chuka hota aur use nikalne ke liye rollback
        // karna padta.
        let [userData, room] = await Promise.all([
            userSchema.model.findOne({ _id: user?._id, socketId,sessionActive:true ,sessionClosed:false}),
            matchSchema.model.findOne({ roomId, end: false }).sort({ createdAt: -1 }).lean()
        ]);

        if (!userData || !room) return io.to(socketId).emit(socketEmit.errorLog, { message:!userData?"User not found": "Invalid match id ." });

        const minCoins = (room?.entryAmount || 0);

        if (!minCoins || (Number(userData?.coins ||0) < Number(minCoins))) {
            return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Insufficient coins to join this table." });
        }

        const previousWinner=String(room?.previousWinner)==String(userData?._id)?true:false

        // Check pass -> ab seat do.
        let matchData = await matchSchema.model.findOneAndUpdate({
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
                $pull: { watchers: user?._id },
                ...(previousWinner?{previousWinner:null}:{})
            },
            { new: true }
        ).sort({ createdAt: -1 }).populate('players', '_id name socketId coins').
            populate('watchers', '_id name socketId coins').lean();


        console.log("::::::::::::::::::::Jo2222222222in Room::::::::", userData?.name);

        if (!matchData) return io.to(socketId).emit(socketEmit.errorLog, { message: "Invalid match id." });

        // players/seat badle -> cache invalidate.
        await deleteMatch(matchData?._id)


        // send emit
        this.sendCommonEmit(io, matchData, socketEmit.joinRoomSuccess)
        this.sendCommonEmitForWatcher(io, matchData, socketEmit.joinRoomSuccess)

        if (matchData?.start == false && (matchData?.players.length == gameConfig?.minPlayer) && !matchData?.waitForNextRount) {

            console.log("::::::::::::::::::::Starting Match:>>>>>>>>>:::::::");
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
       const previousWinnerSeatIndex = previousWinnerIndex(matchData, matchData?.previousWinner)

        const payload = {
            _id: matchData?._id,
            players: matchData?.players,
            roomId: matchData?.roomId,
            gameType: matchData?.gameType,
            start: matchData?.start,
            end: matchData?.end,
            previousWinnerSeatIndex,
        }

        matchData?.players.map((x) => {
            emitToUser(io, x?._id, emit, { ...payload, selfId: x?._id,selfCoin: x?.coins })
        })

    } catch (error) {
        console.log(":::::::::::::errrrrr send coom emit:::::", error)
    }

}


module.exports.sendCommonEmitForWatcher = (io, matchData, emit, data = {}) => {
    try {
        const { watchers, start, end,gameType } = matchData

        if (!matchData || watchers.length == 0) return

        players = matchData.players.map(player => {
            const seat = matchData.seatPosition.find(
                x => String(x?.playerId) === String(player?._id)
            );
            if (seat) return { ...player, index: seat?.index ?? null }
        });

        const payload = {
            _id: matchData?._id, players, roomId: matchData?.roomId, start, end,gameType,
        }


        matchData?.watchers && watchers.map((x) => {
            emitToUser(io, x?._id, emit, { ...payload, selfId: x?._id, ...data ,selfCoin:x?.coins})
        })

    } catch (error) {
        console.log(":::::::::::::errrrrr send coom emit: to watcher:::::::", error)
    }

}


