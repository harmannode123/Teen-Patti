// Dependencies

const { socketEmit, gameConfig } = require("../../helper/appConstant");
const mongoose = require("mongoose");
const roomSchema = require("../../model/room.model");
const userSchema = require("../../model/user.model");
const matchSchema = require("../../model/match.model");
const pendingMatchSchema = require("../../model/pendingmatch.model")
const economySchema = require("../../model/economy.mode.")
const cardDeck = require("../../helper/card.json");
const { messagesArabic, messagesEnglish, RoundTrumpSuit, tableTypes, diamondTable, tableTypeForDiamond } = require("../../helper/appConstant");
const { turnManager, trickFinder, getSuitFromCard,
    colorRoundTurnManager, parseMongoObjectId, getCoinsFromPlayerIndex, getBidNumberForBot,
    getEstimationNumberForBot, getScoreMultiplier, clockWiseTurnManager, sideShowTurnManager } = require("../../helper/utils");
const moment = require('moment')
const { sendFcmNotification } = require('../../helper/firebase.notification');
const notificationSchema = require('../../model/notification.model');

// global variables
global.roomTimeouts = {};
global.dashCallTimeouts = {};
global.turnTimers = {};

const RANKS = {
    TRAIL: 6, PURE_SEQUENCE: 5, SEQUENCE: 4, COLOR: 3, PAIR: 2, HIGH_CARD: 1
}

// move timer
// module.exports.turnTimer = async (io, user, socketId, data) => {
//     let { matchId, turnTimer, dashCall = false } = data;
//     global.turnTimers[matchId] = setTimeout(async () => {
//         if (dashCall) this.dashCall(io, user, socketId, { ...data, dashCall: false });
//     }, parseInt(turnTimer) * 1000);
// };

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}




module.exports.joinRoom = async (io, user, socketId, data = {}) => {
    try {
        let { } = data;

        console.log("::::::::::::::::::::Join Room::::::::", user?.name)

        let [userData, alreadyInMatch] = await Promise.all([
            userSchema.model.findOne({ _id: user?._id, socketId }),
            matchSchema.model.findOne({ players: user?._id, end: false }).lean(),
        ])

        // We will open this comment later 
        //if (alreadyInMatch || !userData) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: alreadyInMatch ? `You are already in match.` : "Invalid socketId." })

        if (userData?.coins < gameConfig?.bootAmount || !userData?.coins) {
            return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: `Insuffictient coins for this game.` })
        }

        const [currentMatch] = await Promise.all([
            await matchSchema.model.findOneAndUpdate({ $expr: { $lt: [{ $size: "$players" }, gameConfig?.maxPlayer] }, start: false }, { $addToSet: { players: userData?._id } }, { new: true }).populate('players', '_id name socketId coins').lean()
        ])

        if (currentMatch) {
            currentMatch?.players.map((x) => {
                io.to(x?.socketId).emit(socketEmit.joinRoomSuccess, { ...currentMatch, selfId: x?._id })
            })
            // this.startMatch(io, currentMatch)
        }
        else {

            let [newMatch] = await Promise.all([
                matchSchema.model.create({ players: [userData?._id] })
            ])

            let players = [{
                _id: userData?._id,
                name: userData?.name,
                socketId: userData?.socketId
            }]

            io.to(socketId).emit(socketEmit.joinRoomSuccess, { _id: newMatch?._id, players, selfId: userData?._id })

            setTimeout(async () => {
                const checkMatch = await matchSchema.model.findOne({ _id: newMatch?._id, start: false }).populate('players', '_id name socketId coins').lean()

                if (checkMatch?.players.length < gameConfig?.minPlayer) await matchSchema.model.deleteOne({ _id: checkMatch?._id })
                else this.startMatch(io, checkMatch)

            }, gameConfig.gameStartAfterCreate)

        }
    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    }
};


module.exports.startMatch = async (io, matchData) => {
    console.log(":::: :::::::::::::::::::::::  startMatch :::::::::::::::::::::::::::::: ");

    let startMatch = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, start: false }, { start: true }, { new: true }).populate('players', 'name socketId coins')

    if (!startMatch) return;

    const updateEconomy = []
    let bootAmount = 0
    let currentBetAmount = gameConfig?.bootAmount

    startMatch.players.map((x) => {
        io.to(x?.socketId).emit(socketEmit.matchStart, { ...matchData })
        updateEconomy.push({ user: x?._id, matchId: startMatch?._id, betAmount: gameConfig?.bootAmount });
        bootAmount = bootAmount + gameConfig?.bootAmount
    })

    //----------Update Economy-------

    await Promise.all([
        economySchema.model.insertMany(updateEconomy),
        userSchema.model.updateMany({ $expr: { $in: ["$_id", startMatch?.players?.map(x => x?._id)] } }, { $inc: { coins: - (gameConfig?.bootAmount) } })
    ])


    //Distribute Card
    const cards = shuffle(cardDeck)

    const playersData = []

    startMatch.players.map((x) => {
        playersData.push({ playerId: x?._id, cards: cards.splice(-3), turn: !playersData[0] ? true : false, })
    })

    const currentPlayerTurn = playersData[0]?.playerId

    setTimeout(async () => {
        console.log(":::: CArd Distribution:: :::: ");

        startMatch = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, }, { playersData, pot: bootAmount, turn: currentPlayerTurn, currentBetAmount }, { new: true }).populate('players', 'name socketId coins')

        // 🎴 STEP 3: Send cards to each player (PRIVATE)
        startMatch.players.forEach((player) => {
            io.to(player.socketId).emit(socketEmit.cardDistributeSuccess, { message: "Card Distribuation success.", _id: startMatch?._id });
        });

        setTimeout(() => {
            this.sendBetTurnEmit(io, currentPlayerTurn, startMatch)

        }, 3000)

    }, 5000)


    setTimeout(async () => {
        console.log(":::: End match :::: ");

        const endMatch = await matchSchema.model.findOneAndUpdate({ _id: startMatch?._id, start: true, end: false }, { end: true }, { new: true }).populate('players', 'name socketId coins').lean()
        endMatch?.players.map((x) => {
            io.to(x?.socketId).emit(socketEmit.gameOver, { ...endMatch })
        })
    }, 120000)
};


module.exports.sendBetTurnEmit = async (io, currentPlayerTurnId, matchData) => {


    const index = matchData?.playersData.findIndex(x => (String(x?.playerId) == String(currentPlayerTurnId)));


    matchData.players.forEach((player) => {
        io.to(player.socketId).emit(socketEmit.betTurn, { _id: matchData?._id, userId: currentPlayerTurnId, timer: 10, index, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot });
    });

    global.turnTimers[String(matchData?._id)] = setTimeout(async () => {

        this.placeBet(io, currentPlayerTurnId, null, {
            isPacked: true,
            amount: 0,
        });

    }, 30000);

}



module.exports.placeBet = async (io, user, socketId, data) => {
    try {

        let userId = socketId ? user?._id : user
        const check = socketId ? { _id: user?._id, socketId } : { _id: user }

        // if turn are run automatic then we will get userId 
        console.log(":::::::::::::::place BEt:::::::::", { userId, name: user?.name, check })

        let [userData, matchData] = await Promise.all([
            userSchema.model.findOne({ ...check }),
            matchSchema.model.findOne({ start: true, end: false, turn: userId }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        ])


        if (!matchData || !userData) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Not your turn." });
        if (data?.amount && data?.amount != matchData?.currentBetAmount) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Invalid bet amount." });

        let nextPlayerTurnId = turnManager(matchData?.playersData, userId,)

        if (!nextPlayerTurnId) return;

        let updatePot = Number(data?.amount) || 0
        let isPacked = data?.isPacked || false

        matchData.playersData.map((x) => {
            if (String(x?.playerId) == String(userId)) {

                if (isPacked) { x.isPacked = isPacked }
                else { x.totalBet += updatePot }
                x.turn = false
            }
            else if (String(x?.playerId) == String(nextPlayerTurnId)) {
                x.turn = true
            }
        })

        clearInterval(global.turnTimers[String(matchData?._id)]);
        matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, {
            turn: nextPlayerTurnId, playersData: matchData?.playersData, $inc: { pot: updatePot },
            ...(isPacked ? { $addToSet: { exitPlayers: userId } } : {}),
            ...(matchData?.sideShow ? { sideShow: false } : {}),
        }, { new: true }).populate('players', 'name socketId coins').lean()


        const index = matchData?.playersData.findIndex(x => (String(x?.playerId) == String(userId)));

        matchData.players.forEach((player) => {
            io.to(player.socketId).emit(socketEmit.successPlaceBet, { _id: matchData?._id, userId, index, isPacked });
        });



        if (turnManager(matchData?.playersData, nextPlayerTurnId)) {

            this.sendBetTurnEmit(io, nextPlayerTurnId, matchData)
        }
        else {

            matchData.players.forEach((player) => {
                io.to(player.socketId).emit(socketEmit.roundWinner, { _id: matchData?._id, winnerId: nextPlayerTurnId });
            });

            await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, { winner: nextPlayerTurnId, end: true }, { new: true }).populate('players', 'name socketId coins').lean()
            //  this.startNextRound(io, matchData)
        }

    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    }

}


module.exports.seenCard = async (io, user, socketId, data) => {
    try {

        let userId = user?._id
        const check = { _id: user?._id, socketId }

        // if turn are run automatic then we will get userId 
        console.log(":::::::::::::::seen card BEt:::::::::", { userId, name: user?.name }, typeof user == Object())

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


        console.log(":::::Seen cards::::::", cards)


        const index = matchData?.playersData.findIndex(x => (String(x?.playerId) == String(userId)));

        matchData.players.forEach((player) => {
            if (String(player?._id) == String(userId)) io.to(player?.socketId).emit(socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index, cards });
            else io.to(player?.socketId).emit(socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index });
        });



    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    }

}


module.exports.sideShow = async (io, user, socketId, data = {}) => {
    try {
        console.log(":::::::;data :::", data)

        const { show } = data
        console.log(":::::::;data :::", data)


        let userId = user?._id
        const check = { _id: user?._id, socketId }

        // if turn are run automatic then we will get userId 
        console.log(":::::::::::::::place BEt:::::::::", { userId, name: user?.name })

        let [userData, matchData] = await Promise.all([
            userSchema.model.findOne({ ...check }),
            matchSchema.model.findOne({ start: true, end: false, turn: userId }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        ])

        if (!matchData || !userData) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Not your turn." });

        const otherPlayer = sideShowTurnManager(matchData?.playersData, userId)


        if (!show) {

            //For Side show
            const { isSeen, playerId } = otherPlayer
            if (!isSeen || !playerId) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Side show not possible." });

            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, sideShow: false }, { sideShow: true, sideShowUser: playerId }).populate('players', 'name socketId coins').lean()
            if (!matchData) return;

            matchData.players.forEach((player) => {
                // if (String(player?._id) == String(userId)) io.to(player?.socketId).emit(socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index, cards });
                io.to(player?.socketId).emit(socketEmit.sideShowRequest, { _id: matchData?._id, from: userId, to: playerId });
            });
        }
        else if (show) {
            //for final show
            const totalPlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
            if (totalPlayers?.length != 2) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Show not possible right now." });

            const { player1, player2, winner } = compareResult(totalPlayers[0], totalPlayers[1])

            matchData.players.forEach((player) => {
                io.to(player?.socketId).emit(socketEmit.roundWinner, { _id: matchData?._id, player1, player2, winnerId: winner });
            });

            clearInterval(global.turnTimers[String(matchData?._id)]);


        }




    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    }
}

module.exports.respondToSideShow = async (io, user, socketId, data = {}) => {
    try {

        const { accept = false } = data

        let userId = user?._id

        let matchData = await matchSchema.model.findOneAndUpdate({ start: true, end: false, sideShow: true, sideShowUser: userId }, { sideShow: false, sideShowUser: null }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        if (!matchData) return;

        const totalPlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
        if (totalPlayers?.length < 3) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "side Show not possible right now." });

        clearInterval(global.turnTimers[String(matchData?._id)]);

        let otherPlayerId = matchData?.turn
        if (accept) {

            const p1 = totalPlayers.find(x => String(x?.playerId) == String(userId))
            const p2 = totalPlayers.find(x => String(x?.playerId) == String(otherPlayerId))

            const { player1, player2, winner } = compareResult(p1, p2)
            const p1Np2Id = [String(userId), String(otherPlayerId)]

            matchData.players.forEach((player) => {

                if (p1Np2Id.includes(String(player?._id))) io.to(player?.socketId).emit(socketEmit.sideShowWinner, { _id: matchData?._id, player1, player2, winnerId: winner });
                else io.to(player?.socketId).emit(socketEmit.sideShowWinner, { _id: matchData?._id, player1, player2, winnerId: winner });
            });

            const looserId = String(userId) == String(winner) ? otherPlayerId : userId


            this.placeBet(io, looserId, null, {
                isPacked: true,
                amount: 0,
            });

        } else {

            matchData.players.forEach((player) => {
                io.to(player?.socketId).emit(socketEmit.rejectSideShow, { _id: matchData?._id, from: userId, to: otherPlayerId });
            });

            this.placeBet(io, otherPlayerId, null, {
                isPacked: false,
                amount: matchData?.currentBetAmount,
            });
        }


    } catch (error) {
        console.log(error);
        return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
    }
}


module.exports.startNextRound = async (io, matchData) => {
    try {
        let players = matchData.players.map(x => x?._id)
        let newMatch = await matchSchema.model.create({ players })
        newMatch = newMatch.toObject()
        this.startMatch(io, newMatch)

    } catch (error) {
        console.log(error);
    }
}

//self exit
module.exports.selfExit = async (io, user, socketId, disconnect = false) => {
    console.log(":::: Self Exit :::: ");

    if (disconnect) {
        await userSchema.model.findOneAndUpdate({ _id: user?._id, socketId }, { socketId: null })
        return;
    }

};


const evaluateHand = (cards) => {
    // sort descending
    const values = cards.map(c => c.cardValue).sort((a, b) => b - a)
    const suits = cards.map(c => c.suit)

    const isSameSuit = suits.every(s => s === suits[0])

    // handle A-2-3 special case
    const isSequence =
        (values[0] - 1 === values[1] && values[1] - 1 === values[2]) ||
        (values.toString() === "14,3,2") // A-3-2

    const counts = {}
    values.forEach(v => counts[v] = (counts[v] || 0) + 1)

    const countValues = Object.values(counts)

    // 🔥 TRAIL
    if (countValues.includes(3)) {
        return {
            rank: RANKS.TRAIL,
            name: "Trail",
            high: values[0]
        }
    }

    // 🔥 PURE SEQUENCE
    if (isSequence && isSameSuit) {
        return {
            rank: RANKS.PURE_SEQUENCE,
            name: "Pure Sequence",
            high: values[0]
        }
    }

    // 🔥 SEQUENCE
    if (isSequence) {
        return {
            rank: RANKS.SEQUENCE,
            name: "Sequence",
            high: values[0]
        }
    }

    // 🔥 COLOR
    if (isSameSuit) {
        return {
            rank: RANKS.COLOR,
            name: "Color",
            high: values
        }
    }

    // 🔥 PAIR
    if (countValues.includes(2)) {
        const pairValue = Number(Object.keys(counts).find(k => counts[k] === 2))
        const kicker = Number(Object.keys(counts).find(k => counts[k] === 1))

        return {
            rank: RANKS.PAIR,
            name: "Pair",
            pairValue,
            kicker
        }
    }

    // 🔥 HIGH CARD
    return {
        rank: RANKS.HIGH_CARD,
        name: "High Card",
        high: values
    }
}

const compareHands = (p1, p2) => {

    // 1️⃣ Compare rank
    if (p1.rank > p2.rank) return 1
    if (p1.rank < p2.rank) return -1

    // 2️⃣ Same type → compare details

    // TRAIL
    if (p1.rank === 6) return p1.high - p2.high

    // PURE SEQUENCE / SEQUENCE
    if (p1.rank === 5 || p1.rank === 4) return p1.high - p2.high

    // COLOR / HIGH CARD
    if (p1.rank === 3 || p1.rank === 1) {
        for (let i = 0; i < 3; i++) {
            if (p1.high[i] !== p2.high[i]) return p1.high[i] - p2.high[i]
        }
        return 0
    }

    // PAIR
    if (p1.rank === 2) {
        if (p1.pairValue !== p2.pairValue)
            return p1.pairValue - p2.pairValue

        return p1.kicker - p2.kicker
    }


    return 0
}

const compareResult = (p1, p2) => {

    const p1Card = p1?.cards
    const p2Card = p2?.cards

    const p1Eval = evaluateHand(p1Card)
    const p2Eval = evaluateHand(p2Card)
    const result = compareHands(p1Eval, p2Eval)

    let winner = null

    if (result > 0) winner = p1?.playerId
    else if (result < 0) winner = p2?.playerId
    else winner = "DRAW"

    return {
        winner,
        player1: {
            cards: p1Card,
            hand: p1Eval.name
        },
        player2: {
            cards: p2Card,
            hand: p2Eval.name
        }
    }

}







