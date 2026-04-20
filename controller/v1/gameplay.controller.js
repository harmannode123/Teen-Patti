// Dependencies

const { socketEmit, gameConfig } = require("../../helper/appConstant");
const mongoose = require("mongoose");
const roomSchema = require("../../model/room.model");
const userSchema = require("../../model/user.model");
const matchSchema = require("../../model/match.model");
const economySchema = require("../../model/economy.mode.")
const cardDeck = require("../../helper/card.json");
const { messagesArabic, messagesEnglish } = require("../../helper/appConstant");
const { turnManager, sideShowTurnManager, evaluateHand, compareHands, compareResult } = require("../../helper/utils");
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

function shuffle(deck) {
    const copy = [...deck];
    for (let i = copy.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
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
        console.log(":::: CArd Distribution:: :::: ", playersData);

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

    const totalActivePlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];

    showEnable = totalActivePlayers.length == 2 ? true : false

    matchData.players.forEach((player) => {
        io.to(player.socketId).emit(socketEmit.betTurn, { _id: matchData?._id, userId: currentPlayerTurnId, timer: 10, index, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, showEnable: showEnable });
    });

    global.turnTimers[String(matchData?._id)] = setTimeout(async () => {

        this.placeBet(io, currentPlayerTurnId, null, {
            isPacked: true,
            amount: 10,
            // isRaisebet: true
        });

    }, 30000);

}



module.exports.placeBet = async (io, user, socketId, data) => {
    try {

        let { amount, isPacked, isRaisebet } = data;


        let userId = socketId ? user?._id : user
        const check = socketId ? { _id: user?._id, socketId } : { _id: user }

        // if turn are run automatic then we will get userId 
        console.log(":::::::::::::::place BEt:::::::::", { userId, name: user?.name, check })

        let [userData, matchData] = await Promise.all([
            userSchema.model.findOne({ ...check }),
            matchSchema.model.findOne({ start: true, end: false, turn: userId, }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        ])



        if (!matchData || !userData) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Not your turn." });
        // else if (amount && amount != matchData?.currentBetAmount) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Invalid bet amount." });

        let currentBet = matchData?.currentBetAmount
        //ADD VALIDATION FOR RAISE BET
        amount = isRaisebet ? Number(currentBet) * 2 : Number(currentBet)

        let nextPlayerTurnId = turnManager(matchData?.playersData, userId,)

        if (!nextPlayerTurnId) return;

        let updatePot = amount
        isPacked = isPacked || false

        matchData.playersData.map((x) => {
            if (String(x?.playerId) == String(userId)) {

                if (isPacked) { x.isPacked = isPacked }
                else if (x?.isSeen) {
                    x.totalBet += updatePot
                }
                else if (matchData?.raise) {
                    x.totalBet += (updatePot / 2)
                }
                else {
                    x.totalBet += updatePot
                }

                x.turn = false
            }
            else if (String(x?.playerId) == String(nextPlayerTurnId)) {
                x.turn = true
            }
        })

        clearInterval(global.turnTimers[String(matchData?._id)]);
        matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, {
            turn: nextPlayerTurnId, playersData: matchData?.playersData, $inc: { pot: updatePot },
            currentBetAmount: amount,
            // ...(disconnect ? { $addToSet: { exitPlayers: userId } } : {}),
            ...(matchData?.sideShow ? { sideShow: false } : {}),
            ...(!matchData?.raise && isRaisebet ? { raise: true } : {}),

        }, { new: true }).populate('players', 'name socketId coins').lean()


        const index = matchData?.playersData.findIndex(x => (String(x?.playerId) == String(userId)));

        matchData.players.forEach((player) => {
            io.to(player.socketId).emit(socketEmit.successPlaceBet, { _id: matchData?._id, userId, index, isPacked, currentBetAmount: matchData?.currentBetAmount });
        });

        if (turnManager(matchData?.playersData, nextPlayerTurnId)) {

            this.sendBetTurnEmit(io, nextPlayerTurnId, matchData)
        }
        else {

            matchData.players.forEach((player) => {
                io.to(player.socketId).emit(socketEmit.roundWinner, { _id: matchData?._id, winnerId: nextPlayerTurnId });
            });

            await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, { winner: nextPlayerTurnId, end: true }, { new: true }).populate('players', 'name socketId coins').lean()
            this.startNextRound(io, matchData)
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
        console.log(":::::::;sideShow :::", data)

        // const { show } = data
        console.log(":::::::;sideShow :::", data)


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

        const totalActivePlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
        if (totalActivePlayers?.length < 2) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Show not possible right now." });

        const show = totalActivePlayers?.length == 2 ? true : false

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
            // const totalPlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
            // if (totalPlayers?.length != 2) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "Show not possible right now." });

            const { player1, player2, winner } = compareResult(totalActivePlayers[0], totalActivePlayers[1])

            matchData.players.forEach((player) => {
                io.to(player?.socketId).emit(socketEmit.roundWinner, { _id: matchData?._id, player1, player2, winnerId: winner });
            });


            clearInterval(global.turnTimers[String(matchData?._id)]);
            await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, { winner: winner, end: true }, { new: true }).populate('players', 'name socketId coins').lean()

            this.startNextRound(io, matchData)



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

        console.log("::::::::::::::::::! accept ", data)

        let matchData = await matchSchema.model.findOneAndUpdate({ start: true, end: false, sideShow: true, sideShowUser: userId }, { sideShow: false, sideShowUser: null }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        if (!matchData) return;
        console.log("::::::::::::::::::2222 accept ", data)


        const totalPlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];
        if (totalPlayers?.length < 3) return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: "side Show not possible right now." });

        clearInterval(global.turnTimers[String(matchData?._id)]);

        console.log("::::::::::::::::::!333333333333 accept ")

        let otherPlayerId = matchData?.turn
        if (accept) {

            const p1 = totalPlayers.find(x => String(x?.playerId) == String(userId))
            const p2 = totalPlayers.find(x => String(x?.playerId) == String(otherPlayerId))

            const { player1, player2, winner } = compareResult(p1, p2)
            const p1Np2Id = [String(userId), String(otherPlayerId)]

            matchData.players.forEach((player) => {

                // if (p1Np2Id.includes(String(player?._id))) io.to(player?.socketId).emit(socketEmit.sideShowWinner, { _id: matchData?._id, player1, player2, winnerId: winner });
                // else io.to(player?.socketId).emit(socketEmit.sideShowWinner, { _id: matchData?._id, player1, player2, winnerId: winner });
                io.to(player?.socketId).emit(socketEmit.sideShowWinner, { _id: matchData?._id, player1, player2, winnerId: winner });

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
        let exitPlayers = matchData.exitPlayers?.map(x => String(x))
        let players = matchData.players.filter(x => {
            if (x?._id && !exitPlayers.includes(String(x?._id))) return x?._id
        })

        if (players.length < 3) return;
        let newMatch = await matchSchema.model.create({ players })
        newMatch = newMatch.toObject()

        setTimeout(() => {
            this.startMatch(io, newMatch)

        }, 5000);

    } catch (error) {
        console.log(error);
    }
}

//self exit
module.exports.selfExit = async (io, user, socketId, disconnect = false) => {
    console.log(":::: Self Exit :::: ");

    if (disconnect) {

        await Promise.all([
            userSchema.model.findOneAndUpdate({ _id: user?._id, socketId }, { socketId: null }),
            matchSchema.model.findOneAndUpdate({ players: user?._id, start: true, end: false }, { $addToSet: { exitPlayers: user?._id } }).sort({ createdAt: -1 }).populate('players', 'name socketId coins').lean()
        ])
        return;
    }

};








