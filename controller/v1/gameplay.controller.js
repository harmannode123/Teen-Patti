// Dependencies

const { socketEmit, gameConfig } = require("../../helper/appConstant");
const mongoose = require("mongoose");
const roomSchema = require("../../model/room.model");
const userSchema = require("../../model/user.model");
const matchSchema = require("../../model/match.model");
const economySchema = require("../../model/economy.mode.")
const cardDeck = require("../../helper/card.json");
const { messagesArabic, messagesEnglish } = require("../../helper/appConstant");
const { turnManager, sideShowTurnManager, evaluateHand, compareHands, compareResult, parseMongoObjectId, checkIndex } = require("../../helper/utils");
const moment = require('moment')
const { sendFcmNotification } = require('../../helper/firebase.notification');
const notificationSchema = require('../../model/notification.model');

// global variables
global.roomTimeouts = {};
global.dashCallTimeouts = {};
global.turnTimers = {};


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

        console.log("::::::::::::::::::index::::", data)


        data.sort((a, b) => a.index - b.index); // ascending order

        return data;
    } catch (error) {
        throw new Error(error)
    }
};


module.exports.startMatch = async (io, matchData) => {
    console.log(":::: :::::::::::::::::::::::  startMatch :::::::::::::::::::::::::::::: ", matchData?._id);

    try {
        let startMatch = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id, start: false }, { start: true }, { new: true }).populate('players', 'name socketId coins').lean()

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





        //----------Update Economy-------

        await Promise.all([
            economySchema.model.insertMany(updateEconomy),
            userSchema.model.updateMany({ $expr: { $in: ["$_id", startMatch?.players?.map(x => x?._id)] } }, { $inc: { coins: - (gameConfig?.bootAmount) } })
        ])


        //Distribute Card
        const cards = shuffle(cardDeck)


        const playersData = []

        sortPlayer.map((x) => {
            if (x?._id && x?.index >= 0) playersData.push({ playerId: x?._id, cards: cards.splice(-3), turn: !playersData[0] ? true : false, index: x?.index })
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
                sendBetTurnEmit(io, currentPlayerTurn, startMatch)

            }, 3000)

        }, 5000)


    } catch (error) {
        console.log("::::::::::::::::::::::::::::::::::::::start match error::::::::::", error)
        // return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });

    }
};


const sendBetTurnEmit = async (io, currentPlayerTurnId, matchData) => {


    try {

        let index = checkIndex(matchData, currentPlayerTurnId)

        const totalActivePlayers = matchData?.playersData?.filter(x => !x?.isPacked) || [];

        showEnable = totalActivePlayers.length == 2 ? true : false

        matchData.players.forEach((player) => {
            io.to(player.socketId).emit(socketEmit.betTurn, { _id: matchData?._id, userId: currentPlayerTurnId, timer: 10, index, currentBetAmount: matchData?.currentBetAmount, pot: matchData?.pot, showEnable: showEnable });
        });

        global.turnTimers[String(matchData?._id)] = setTimeout(async () => {

            this.placeBet(io, currentPlayerTurnId, null, {
                isPacked: true,
                amount: 0,
                // isRaisebet: true
            });

        }, 30000);
    } catch (error) {
        throw new Error(error)
    }

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


        const index = checkIndex(matchData, userId)

        matchData.players.forEach((player) => {
            io.to(player.socketId).emit(socketEmit.successPlaceBet, { _id: matchData?._id, userId, index, isPacked, currentBetAmount: matchData?.currentBetAmount });
        });

        if (turnManager(matchData?.playersData, nextPlayerTurnId)) {

            sendBetTurnEmit(io, nextPlayerTurnId, matchData)
        }
        else {

            matchData.players.forEach((player) => {
                io.to(player.socketId).emit(socketEmit.roundWinner, { _id: matchData?._id, winnerId: nextPlayerTurnId });
            });

            matchData = await matchSchema.model.findOneAndUpdate({ _id: matchData?._id }, { winner: nextPlayerTurnId, end: true }, { new: true }).populate('players', 'name socketId coins').lean()
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


        // const index = matchData?.playersData.findIndex(x => (String(x?.playerId) == String(userId)));

        const index = checkIndex(matchData, userId)
        matchData.players.forEach((player) => {
            if (String(player?._id) == String(userId)) io.to(player?.socketId).emit(socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index, cards });
            // else io.to(player?.socketId).emit(socketEmit.seenCardSuccess, { _id: matchData?._id, userId, index });
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
            if (x?._id && !exitPlayers.includes(String(x?._id))) return String(x?._id)
        })

        let seatPosition = matchData.seatPosition.filter(x => {
            //We can change this in  future only new player save the player array
            if (x?.playerId && !exitPlayers.includes(String(x?.playerId))) return x
        })


        let [newMatch] = await Promise.all([
            matchSchema.model.create({ players, roomId: matchData?.roomId, seatPosition, waitForNextRount: true, watchers: matchData?.watchers })
        ])
        newMatch = newMatch.toObject()

        setTimeout(async () => {

            const updateMatch = await matchSchema.model.findOneAndUpdate({ _id: newMatch?._id }, { waitForNextRount: false }).lean()

            if (updateMatch.players.length >= gameConfig?.minPlayer) this.startMatch(io, updateMatch)

        }, 5000);

    } catch (error) {
        console.log(error);
    }
}

//self exit
module.exports.selfExit = async (io, user, socketId, disconnect = false) => {
    console.log(":::: Self Exit :::: ");


    await Promise.all([
        userSchema.model.findOneAndUpdate({ _id: user?._id, socketId }, { socketId: null }),
        matchSchema.model.updateMany({ players: user?._id, start: true, end: false }, {
            $addToSet: { exitPlayers: user?._id },
            //$pull: { players: user?._id, seatPosition: { playerId: user._id } }
        }),
        matchSchema.model.updateMany({ players: user?._id, start: false, end: false }, {
            // $addToSet: { exitPlayers: user?._id },
            $pull: { players: user?._id, seatPosition: { playerId: user._id } }
        })
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
                end: 1
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
            ).sort({ createdAt: -1 }).populate('players', '_id name socketId coins').lean()
        ]);


        console.log("::::::::::::::::::::Jo2222222222in Room::::::::", userData?.name, matchData);

        if (!userData || !matchData) return io.to(socketId).emit(socketEmit.errorLog, { message: "Invalid match id ." });


        // send emit
        this.sendCommonEmit(io, matchData, socketEmit.joinRoomSuccess)


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
            if (seat) return { ...player, index: seat?.index ?? null }
        });

        console.log("::::::;;chy,matchData.players", matchData.players)

        matchData?.players.map((x) => {
            io.to(x?.socketId).emit(emit, { ...matchData, selfId: x?._id })
        })

    } catch (error) {
        console.log(":::::::::::::errrrrr send coom emit:::::", error)
    }

}


// module.exports.joinRoomNew = async (io, user, socketId, data = {}) => {
//     try {
//         let { roomId, index = -1 } = data;

//         console.log("::::::::::::::::::::Join Room::::::::", user?.name, data);

//         if (!roomId || index < 0) return;

//         let [userData, matchData] = await Promise.all([
//             userSchema.model.findOne({ _id: user?._id, socketId }),
//             matchSchema.model.findOneAndUpdate({
//                 roomId,
//                 players: { $ne: user?._id },
//                 end: false,
//                 seatPosition: {
//                     $not: {
//                         $elemMatch: { index: index }
//                     }
//                 }
//             },
//                 {
//                     $addToSet: { players: user?._id },
//                     $push: { seatPosition: { playerId: user?._id, index } },
//                     $pull: { watchers: user?._id }
//                 },
//                 { new: true }
//             ).sort({ createdAt: -1 }).populate('players', '_id name socketId coins').lean()
//         ]);


//         console.log("::::::::::::::::::::Jo2222222222in Room::::::::", userData?.name, matchData);

//         if (!userData || !matchData) return io.to(socketId).emit(socketEmit.errorLog, { message: "Invalid match id ." });


//         // send emit
//         this.sendCommonEmit(io, matchData, socketEmit.joinRoomSuccess)


//         if (matchData?.start == false && (matchData?.players.length == 4) && !matchData?.waitForNextRount) {

//             const match = []
//             for (let i = 0; i < 10; i++) {
//                 match.push({ roomId: matchData?.roomId, players: matchData?.players, seatPosition: matchData.seatPosition })
//             }
//             const db = await matchSchema.model.insertMany(match)

//             const matche = await matchSchema.model.find({ start: false }).sort({ createdAt: -1 }).limit(100).lean()

//             for (let i = 0; i < matche.length; i++) {
//                 this.startMatch(io, matche[i])

//             }


//         }


//     } catch (error) {
//         console.log(error);
//         return io.to(socketId).emit(socketEmit.errorLog, { status: 400, message: error.message });
//     }
// };


