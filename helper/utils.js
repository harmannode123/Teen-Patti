const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const salt = process.env.SALT;
const { messagesEnglish, suits } = require('./appConstant');
const cards = require('../helper/card.json')
const matchSchema = require('../model/match.model')

module.exports.createErrorResponse = (message, success = false) => {
    return { success, message: messagesEnglish[message] };
};

module.exports.createSuccessResponse = (message, data, success = true) => {
    return { success, message: messagesEnglish[message], data };
};

module.exports.generateOtp = () => {
    return Math.floor(100000 + Math.random() * 900000);
}

module.exports.generateToken = (data, option) => jwt.sign(data, process.env.SECRET_KEY, option)

module.exports.verifyToken = (token) => {

    try { return jwt.verify(token, process.env.SECRET_KEY) }
    catch (error) { return false }
}

module.exports.hashPassword = password => bcrypt.hash(password, parseInt(salt))

module.exports.comparePassword = async (hash, text) => {

    try { return bcrypt.compare(text, hash) }
    catch (error) { return false }
}

module.exports.customBodyParser = (data) => {
    data['limit'] = data['limit'] ? parseInt(data['limit']) : 10;
    data['offset'] = data['offset'] ? parseInt(data['offset']) : 0;
    data['order'] = data['order'] ? parseInt(data['order']) : null;
    data['sort'] = data['sort'] ? data['sort'] : null;
    data['search'] = data['search'] ? data['search'] : null;
    return data;
}

module.exports.escapeSpecialCharacter = (text) => {

    if (text) return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    else return '';
}


module.exports.paginationData = (totalCount, limit, offset) => {

    let totalPages = Math.ceil(totalCount / limit);
    let currentPage = Math.floor(offset / limit);
    let prevPage = (currentPage - 1) > 0 ? (currentPage - 1) * limit : 0;
    let nextPage = (currentPage + 1) <= totalPages ? (currentPage + 1) * limit : 0;

    return {
        totalCount,
        nextPage,
        prevPage,
        currentPage: currentPage + 1
    }
}

module.exports.isMongoObjectId = (id) => mongoose.Types.ObjectId.isValid(id)

module.exports.parseMongoObjectId = (id) => {

    try { return new mongoose.Types.ObjectId(id); }
    catch (error) { return false }
}

module.exports.createPublicFolder = async () => {

    if (!fs.existsSync('public')) fs.mkdirSync('public')
    if (!fs.existsSync('public/user')) fs.mkdirSync('public/user')

    return;
}

module.exports.parseToJson = (string) => {

    try { return JSON.parse(string) }
    catch (e) { return false }
}

module.exports.languageSelector = (req, res, next) => {

    req.language = req.headers.language == "ar" ? "ar" : "en";
    next();
}

module.exports.turnManager = (playersData, currentUser) => {
    const activePlayers = playersData?.filter(x => !x?.isPacked) || [];

    if (activePlayers.length <= 1) return null;

    const index = activePlayers.findIndex(
        x => String(x?.playerId) === String(currentUser)
    );

    if (index === -1) return null; // safety

    // circular next player
    const nextIndex = (index + 1) % activePlayers.length;

    return activePlayers[nextIndex]?.playerId;
};


module.exports.sideShowTurnManager = (playersData, currentUser) => {
    const activePlayers = playersData?.filter(x => !x?.isPacked) || [];

    if (activePlayers.length < 2) return null; // side show is not possible

    const index = activePlayers.findIndex(
        x => String(x?.playerId) === String(currentUser)
    );

    if (index == -1) return null; // safety check

    // circular previous player
    const sideIndex = (index - 1 + activePlayers.length) % activePlayers.length;

    return activePlayers[sideIndex];
};

// module.exports.antiClockWiseTurnManager = (players, currentUser, data, clockWise = false) => {
//     const cardRound = data?.cardRound
//     const allplayedCond = data?.allplayedCond
//     const dashCall = data?.dashCall
//     const estimation = data?.estimation

//     var playersPlayed = players.map(x => {
//         if (cardRound) return x.player
//         else if (!x.turnPlayed && !x.estimation && !x.dashCall && !x.callBider && !x.pass) return x.player
//     }).filter(Boolean)



//     if (cardRound || dashCall) {
//         const index = playersPlayed.findIndex(x => x.toString() === currentUser.toString());

//         if (allplayedCond) {
//             return { player: null, playersLeft: 0 }
//         }
//         else if (playersPlayed[index + 1]) {
//             let turnUser = players.find(e => e.player.toString() == playersPlayed[index + 1].toString())
//             return { player: playersPlayed[index + 1], isBoat: turnUser?.isBoat || false, playersLeft: playersPlayed.length - 1 }
//         }
//         else {
//             let turnUser = players.find(e => e.player.toString() == playersPlayed[0].toString())
//             return { player: playersPlayed[0], playersLeft: playersPlayed.length - 1, isBoat: turnUser?.isBoat || false }
//         }
//     }


//     var playersPlayed = players.map(x => {
//         if (cardRound) return x.player
//         else if (!x.turnPlayed && !x.estimation && !x.dashCall && !x.callBider && !x.pass && String(x.player) != String(currentUser)) return x.player
//     }).filter(Boolean)


//     const index = playersPlayed.findIndex(x => x.toString() === currentUser.toString());

//     if (clockWise) {
//         if (playersPlayed[index - 1]) {
//             let turnUser = players.find(e => e.player.toString() == playersPlayed[index - 1].toString())
//             return { player: playersPlayed[index - 1], isBoat: turnUser?.isBoat || false, playersLeft: playersPlayed.length - 1 }
//         }
//         else {
//             let turnUser = players.find(e => e.player.toString() == playersPlayed[playersPlayed.length - 1])
//             return { player: playersPlayed[playersPlayed.length - 1], isBoat: turnUser?.isBoat || false, playersLeft: playersPlayed.length - 1 }
//         }
//     }

//     if (playersPlayed[index + 1]) {
//         let turnUser = players.find(e => e.player.toString() == playersPlayed[index + 1].toString())
//         return { player: playersPlayed[index + 1], isBoat: turnUser?.isBoat || false, playersLeft: playersPlayed.length - 1 }
//     }
//     else {
//         let turnUser = players.find(e => e.player.toString() == playersPlayed[0])
//         return { player: playersPlayed[0], isBoat: turnUser?.isBoat || false, playersLeft: playersPlayed.length - 1 }
//     }


// }


module.exports.colorRoundTurnManager = (players, currentUser, data) => {

    if (data.allplayedCond) {
        return { player: null, playersLeft: 0 }
    }
    var playersPlayed = players.map(x => {
        if (!x.estimation) return x.player
    }).filter(Boolean)


    const index = playersPlayed.findIndex(x => x.toString() === currentUser.toString());
    if (playersPlayed[index + 1]) {
        return { player: playersPlayed[index + 1], playersLeft: playersPlayed.length - 1 }
    }
    else {
        return { player: playersPlayed[0], playersLeft: playersPlayed.length - 1 }
    }


}

module.exports.trickFinder = (playersData, firstUser) => {
    const callBider = playersData.find(x => x.callBider)
    const trumpSuit = playersData.find(x => x.callBider).trumpSuit
    firstUser = firstUser ? firstUser.toString() : firstUser
    let startingUser = playersData.find(x => (x.player).toString() == firstUser) || callBider

    const callBiderSuit = callBider?.lastCardPlayed.cardId[callBider?.lastCardPlayed?.cardId?.length - 1]
    const playerWithValue = playersData.map(card => {
        if (trumpSuit == this.getSuitFromCard(card)) return { user: card.player, value: card.lastCardPlayed.cardValue, wins: card.wins + 1, estimationNumber: card?.estimationNumber || 0, type: 'sameTrumpSuit' }
        else if (this.getSuitFromCard(card) == this.getSuitFromCard(startingUser)) return { user: card.player, value: card.lastCardPlayed.cardValue, wins: card.wins + 1, estimationNumber: card?.estimationNumber || 0, type: "sameCallerSuit" }
        else return { user: card.player, value: 0, wins: card.wins + 1, estimationNumber: card?.estimationNumber || 0, type: "other" }
    })

    let sameCallerCond = playerWithValue.filter(e => e.type == "sameCallerSuit")
    let sameTrumpCond = playerWithValue.filter(e => e.type == "sameTrumpSuit")


    let maxUser = null
    if (sameTrumpCond.length > 0) {
        maxUser = sameTrumpCond.reduce((max, entry) => entry.value > max.value ? entry : max, sameTrumpCond[0]);
    }
    else if (sameCallerCond.length > 0) {
        maxUser = sameCallerCond.reduce((max, entry) => entry.value > max.value ? entry : max, sameCallerCond[0]);
    }
    else {
        maxUser = { user: startingUser.player, value: startingUser.lastCardPlayed.cardValue, wins: startingUser.wins + 1, estimationNumber: startingUser?.estimationNumber || 0 }
        //playerWithValue.reduce((max, entry) => entry.value > max.value ? entry : max, playerWithValue[0]);
    }

    // const maxUser = playerWithValue.reduce((max, entry) => entry.value > max.value ? entry : max, playerWithValue[0]);

    // console.log('maxUser', maxUser)

    return { ...maxUser, callBider }
}


module.exports.getSuitFromCard = (card, key = false) => {
    console.log('card1111', card?.lastCardPlayed)
    let cardData = null
    if (key) {
        cardData = card[card.length - 1]
    }
    else {
        cardData = card?.lastCardPlayed?.cardId[card?.lastCardPlayed.cardId?.length - 1]
    }
    switch (cardData) {
        case "S":
            return suits.spade
            break;

        case "D":
            return suits.diamond
            break;

        case "H":
            return suits.heart
            break;

        case "C":
            return suits.clubs
            break;

        default:
            return suits.clubs
            break;
    }

}


module.exports.generateFiveDigitNumber = () => {
    return Math.floor(10000 + Math.random() * 90000).toString()
}


module.exports.getCoinsFromPlayerIndex = (resultArray, playerId, coins, diamondTable = false) => {
    let index = resultArray.findIndex(x => x.player.toString() == playerId.toString())

    switch (index) {
        case 0:
            coins = diamondTable ? 3 : coins / 2
            break;
        case 1:
            coins = diamondTable ? 1 : (37.5 / 100) * coins
            break;
        case 2:
            coins = diamondTable ? 0 : coins / 8
            break;

        case 3:
            coins = 0
            break;

        default:
            coins = 0
            break;
    }

    return coins


}


const getMaxValueKeys = (obj) => {
    const maxValue = Math.max(...Object.values(obj));
    return Object.keys(obj).filter(key => obj[key] === maxValue);
};


module.exports.getBidNumberForBot = (cards, previousNumber = 4, firstTurn) => {
    let number = cards.filter(e => e?.cardValue == 14 || e?.cardValue == 13 || e?.cardValue == 12).length

    let cardsObject = cards.reduce((acc, cv, ci, arr) => {
        let cardSuit = this.getSuitFromCard(cv.cardId, true)
        if (acc[cardSuit]) acc[cardSuit] = acc[cardSuit] + 1
        else acc[cardSuit] = 1
        return acc
    }, {})

    let trumpSuit = getMaxValueKeys(cardsObject)[0]

    if (number <= previousNumber && !firstTurn) {
        return {
            isPass: true,
            number: previousNumber,
            trumpSuit
        }
    }
    if (number >= 4) {
        return {
            isPass: false,
            number,
            trumpSuit
        }
    }
    else {
        return {
            isPass: true,
            number: 4,
            trumpSuit
        }
    }
}



module.exports.getEstimationNumberForBot = (cards) => {
    let number = cards.filter(e => e?.cardValue == 14 || e?.cardValue == 13 || e?.cardValue == 12).length
    return number
}


module.exports.getScoreMultiplier = async (roomId, matchId) => {
    let totalMatches = await matchSchema.model.find({ room: roomId, _id: { $ne: matchId } }).sort({ createdAt: -1 })
        .limit(3)
        .lean()

    let scoreMultiplier = 1
    if (totalMatches.length >= 2) {
        if (totalMatches[0]?.matchResult == "syedaha" && totalMatches[1]?.matchResult == "syedaha") scoreMultiplier = 4
        else if (totalMatches[0]?.matchResult == "syedaha") scoreMultiplier = 2

    }
    else if (totalMatches[0]?.matchResult == "syedaha") {
        scoreMultiplier = 2
    }

    return scoreMultiplier

}

module.exports.clockWiseTurnManager = (players, currentUser, data) => {
    const cardRound = data?.cardRound
    const allplayedCond = data?.allplayedCond
    const dashCall = data?.dashCall
    const estimation = data?.estimation

    var playersPlayed = players.map(x => {
        if (cardRound) return x.player
        else if (!x.turnPlayed && !x.estimation && !x.dashCall && !x.callBider && !x.pass) return x.player
    }).filter(Boolean)

    var playersPlayed = players.map(x => {
        if (cardRound) return x.player
        else if (!x.turnPlayed && !x.estimation && !x.dashCall && !x.callBider && !x.pass && String(x.player) != String(currentUser)) return x.player
    }).filter(Boolean)


    const index = playersPlayed.findIndex(x => x.toString() === currentUser.toString());

    if (playersPlayed[index - 1]) {
        let turnUser = players.find(e => e.player.toString() == playersPlayed[index + 1].toString())
        return { player: playersPlayed[index - 1], isBoat: turnUser?.isBoat || false, playersLeft: playersPlayed.length - 1 }
    }
    else {
        let turnUser = players.find(e => e.player.toString() == playersPlayed[3])
        return { player: playersPlayed[0], isBoat: turnUser?.isBoat || false, playersLeft: playersPlayed.length - 1 }
    }


}