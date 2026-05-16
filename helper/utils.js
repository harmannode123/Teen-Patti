const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const salt = process.env.SALT;
const { messagesEnglish, suits } = require('./appConstant');
const cards = require('../helper/card.json')
const matchSchema = require('../model/match.model');

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



module.exports.generateFiveDigitNumber = () => {
    return Math.floor(10000 + Math.random() * 90000).toString()
}

const RANKS = {
    TRAIL: 6, PURE_SEQUENCE: 5, SEQUENCE: 4, COLOR: 3, PAIR: 2, HIGH_CARD: 1
}

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

module.exports.compareResult = (p1, p2) => {

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
            hand: p1Eval.name,
            playerId: p1?.playerId,
            index: p1?.index || -1
        },
        player2: {
            cards: p2Card,
            hand: p2Eval.name,
            playerId: p2?.playerId,
            index: p2?.index || -1

        }
    }

}

module.exports.checkIndex = (matchData, playerId) => {
    let seat = matchData?.seatPosition.find(x => (String(x?.playerId) == String(playerId)));
    let index = seat?.index ?? -1
    return index
}



