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
    // Betting turn: packed + ALL-IN dono skip (all-in player bet nahi kar sakta).
    // (Non-all-in games me isAllIn hamesha false -> koi behaviour change nahi.)
    const activePlayers = playersData?.filter(x => !x?.isPacked && !x?.isAllIn) || [];

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
    const activePlayers = playersData?.filter(x => !x?.isPacked && !x?.isAllIn) || [];

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

// Generate every possible group of `groupSize` cards out of `cards`.
// e.g. pick 3 cards out of 4 -> returns all 4 possible 3-card groups.
const getCardCombinations = (cards, groupSize) => {
    if (groupSize <= 0) return [[]]
    if (!cards || cards.length < groupSize) return []
    if (groupSize === cards.length) return [cards.slice()]
    if (groupSize === 1) return cards.map(card => [card])

    const combinations = []
    cards.forEach((currentCard, currentIndex) => {
        const remainingCards = cards.slice(currentIndex + 1)
        const smallerGroups = getCardCombinations(remainingCards, groupSize - 1)
        smallerGroups.forEach(group => combinations.push([currentCard, ...group]))
    })
    return combinations
}

const FULL_DECK = require('./card.json')

// Resolve a player's best 3-card hand regardless of how many cards were dealt.
//  - 3 cards (classic) : evaluate as-is
//  - >3 cards (4-card) : CHOOSE the best finalHandSize-subset of the dealt cards
//  - <3 cards (2-card) : ASSUME the missing card(s) from the deck to build the
//                        strongest possible finalHandSize combo (official 2-card rule)
// `usedCards` holds the actual cards that formed the winning hand (assumed cards
// included), so the client can display the resolved combination.
const evaluateBestHand = (dealtCards, finalHandSize = 3) => {
    if (!dealtCards || dealtCards.length === 0) return evaluateHand(dealtCards)

    if (dealtCards.length === finalHandSize) {
        const handResult = evaluateHand(dealtCards)
        handResult.usedCards = dealtCards
        return handResult
    }

    let possibleHands

    if (dealtCards.length > finalHandSize) {
        // four-card style: pick the best subset of the cards we already hold
        possibleHands = getCardCombinations(dealtCards, finalHandSize)
    } else {
        // two-card style: assume the missing card(s) from the remaining deck
        const dealtCardIds = new Set(dealtCards.map(card => card?.cardId))
        const remainingDeck = FULL_DECK.filter(card => !dealtCardIds.has(card?.cardId))
        const missingCardCount = finalHandSize - dealtCards.length
        const assumedCardSets = getCardCombinations(remainingDeck, missingCardCount)
        possibleHands = assumedCardSets.map(assumedCards => [...dealtCards, ...assumedCards])
    }

    let bestHand = null
    let bestHandCards = null

    for (const hand of possibleHands) {
        const handResult = evaluateHand(hand)
        if (!bestHand || compareHands(handResult, bestHand) > 0) {
            bestHand = handResult
            bestHandCards = hand
        }
    }

    bestHand.usedCards = bestHandCards
    return bestHand
}

module.exports.evaluateBestHand = evaluateBestHand

// JOKER / ZHANDU VARIANT ----------------------------------------------------
// One OR MORE ranks are "wild" (the joker value(s)). Any dealt card whose
// cardValue matches a joker value can be assumed to be ANY card. We keep the
// non-joker cards fixed and try every possible replacement for the joker card(s),
// then return the strongest resulting hand. `usedCards` shows the resolved cards.
//
// `jokerValue` accepts:
//   - a single number  (classic single-joker variant)            -> e.g. 7
//   - an array of nums  (ZHANDU: up to 3 opened jokers are wild)  -> e.g. [7,3,9]
// Empty/null -> no wild ranks -> behaves like a normal best hand.
const evaluateBestHandWithJoker = (dealtCards, jokerValue, finalHandSize = 3) => {
    if (!dealtCards || dealtCards.length === 0) return evaluateHand(dealtCards)

    // Normalize joker value(s) to a Set of wild ranks (single ya array dono chalein).
    const jokerValueSet = new Set(
        Array.isArray(jokerValue)
            ? jokerValue.filter(v => v != null)
            : (jokerValue != null ? [jokerValue] : [])
    )

    const fixedCards = dealtCards.filter(card => !jokerValueSet.has(card?.cardValue))
    const jokerCount = dealtCards.length - fixedCards.length

    // No joker in this player's hand -> evaluate it like a normal hand
    if (jokerCount === 0) return evaluateBestHand(dealtCards, finalHandSize)

    // Replacement cards must be real, distinct cards not already in the hand
    const dealtCardIds = new Set(dealtCards.map(card => card?.cardId))
    const remainingDeck = FULL_DECK.filter(card => !dealtCardIds.has(card?.cardId))

    let bestHand = null
    let bestHandCards = null

    for (const replacementCards of getCardCombinations(remainingDeck, jokerCount)) {
        const candidateHand = [...fixedCards, ...replacementCards]
        const handResult = evaluateBestHand(candidateHand, finalHandSize)
        if (!bestHand || compareHands(handResult, bestHand) > 0) {
            bestHand = handResult
            bestHandCards = handResult.usedCards
        }
    }

    bestHand.usedCards = bestHandCards
    return bestHand
}

module.exports.evaluateBestHandWithJoker = evaluateBestHandWithJoker

// Resolve a player's final hand based on the match's game variant.
// Joker uses the wild-card evaluator; everyone else (classic / 4-card / 2-card /
// muflis) uses the normal best-hand evaluator. Muflis does NOT change the hand
// here — only its ranking direction differs, which is applied in compareEvaluatedHands.
const resolvePlayerHand = (dealtCards, matchContext = {}) => {
    const { gameType, jokerValue, jokerValues } = matchContext

    // ZHANDU: jokerValues = abhi tak khule jokers ke cardValue ka array (0..3 wild ranks).
    if (gameType === "zhandu") {
        return evaluateBestHandWithJoker(dealtCards, jokerValues || [])
    }

    if (gameType === "joker" && jokerValue != null) {
        return evaluateBestHandWithJoker(dealtCards, jokerValue)
    }
    return evaluateBestHand(dealtCards)
}

// Compare two evaluated hands honoring the variant's ranking direction.
// Muflis reverses the ranking (weakest normal hand wins), so we flip the normal
// comparison. Returns > 0 if handA wins, < 0 if handB wins, 0 = draw.
const compareEvaluatedHands = (handA, handB, gameType) => {
    const normalResult = compareHands(handA, handB)
    return gameType === "muflis" ? -normalResult : normalResult
}

module.exports.compareResult = (player1, player2, matchContext = {}) => {

    const player1Cards = player1?.cards
    const player2Cards = player2?.cards

    const player1Hand = resolvePlayerHand(player1Cards, matchContext)
    const player2Hand = resolvePlayerHand(player2Cards, matchContext)
    const result = compareEvaluatedHands(player1Hand, player2Hand, matchContext?.gameType)

    let winner = null

    if (result > 0) winner = player1?.playerId
    else if (result < 0) winner = player2?.playerId
    else winner = "DRAW"

    return {
        winner,
        player1: {
            cards: player1Cards,
            bestCards: player1Hand.usedCards,
            hand: player1Hand.name,
            playerId: player1?.playerId,
            index: player1?.index || -1
        },
        player2: {
            cards: player2Cards,
            bestCards: player2Hand.usedCards,
            hand: player2Hand.name,
            playerId: player2?.playerId,
            index: player2?.index || -1

        }
    }

}

// ZHANDU: match ke jokerCards me se sirf KHULE (opened) jokers ke cardValue ka
// array do. Yahi wild ranks hote hain jo hand evaluation me lagte hain.
// (non-zhandu / no jokers -> empty array.)
module.exports.getOpenedJokerValues = (matchData) => {
    if (!matchData?.jokerCards?.length) return []
    return matchData.jokerCards
        .filter(j => j?.opened && j?.card?.cardValue != null)
        .map(j => j.card.cardValue)
}

// ZHANDU + ALL-IN (Phase 5): is player par abhi konse joker apply hote.
//  - Normal player (non-all-in): saare KHULE jokers.
//  - All-in player: khule jokers me se sirf pehle `appliedJokers` (J1,J2 ya J1,J2,J3),
//    kyunki all-in ke waqt uska joker count freeze ho jaata (§5). opened values order
//    me hote (J1,J2,J3), to slice(0, appliedJokers). Zyada joker baad me khulein tab bhi
//    all-in player ko utne hi (freeze). openedCount se bhi cap ho jaata (min).
module.exports.getApplicableJokerValues = (matchData, player) => {
    const opened = module.exports.getOpenedJokerValues(matchData)
    if (player?.isAllIn && player?.appliedJokers != null) {
        return opened.slice(0, player.appliedJokers)
    }
    return opened
}

// ALL-IN (Phase 5): SIDE POTS banana. Har player ka contribution = boot + totalBet
// (FOLDED bhi include -> unka paisa "dead money" pots me jaata, par wo jeet nahi sakte).
// Sabse chhoti contribution se layer-by-layer pots: har pot ka `eligible` = wahi
// non-folded players jinhone us level tak daala. Uncontested layer (sirf 1 eligible)
// ka paisa us player ko wapas mil jaata (wo akela "jeet" leta).
module.exports.buildSidePots = (playersData, bootAmount = 0) => {
    const remaining = {}
    ;(playersData || []).forEach(p => { remaining[String(p?.playerId)] = (bootAmount || 0) + (p?.totalBet || 0) })

    const eligible = (playersData || []).filter(p => !p?.isPacked).map(p => String(p?.playerId))
    const pots = []
    let guard = 0
    while (guard++ < 100) {
        const activeElig = eligible.filter(id => remaining[id] > 0)
        if (!activeElig.length) break
        const level = Math.min(...activeElig.map(id => remaining[id]))
        let amount = 0
        for (const id in remaining) {
            const take = Math.min(level, remaining[id])
            if (take > 0) { amount += take; remaining[id] -= take }
        }
        if (amount > 0) pots.push({ amount, eligible: [...activeElig] })
    }
    // Bacha hua folded over-contribution (rare) -> last pot me daal do (total conserve).
    const leftover = Object.values(remaining).reduce((a, b) => a + (b > 0 ? b : 0), 0)
    if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover
    return pots
}

// ALL-IN (Phase 5): ek pot ke eligible players me se WINNER(s). Har entry ka apna
// jokerValues (all-in wale ko kam). Best hand jeeta; tie -> multiple winners (split).
// entries: [{ id, cards, jokerValues }]  ->  { winners: [id...], handName }
module.exports.pickPotWinners = (entries, gameType) => {
    let best = null, winners = [], handName = null
    for (const e of entries || []) {
        const hand = (e?.jokerValues && e.jokerValues.length)
            ? evaluateBestHandWithJoker(e.cards, e.jokerValues)
            : evaluateBestHand(e.cards)
        if (!best) { best = hand; winners = [e.id]; handName = hand.name; continue }
        let cmp = compareHands(hand, best)
        if (gameType === "muflis") cmp = -cmp
        if (cmp > 0) { best = hand; winners = [e.id]; handName = hand.name }
        else if (cmp === 0) { winners.push(e.id) }
    }
    return { winners, handName }
}

module.exports.checkIndex = (matchData, playerId) => {
    let seat = matchData?.seatPosition.find(x => (String(x?.playerId) == String(playerId)));
    let index = seat?.index ?? -1
    return index
}

module.exports.previousWinnerIndex = (matchData, playerId) => {
    let seat = matchData?.seatPosition.find(x => (String(x?.playerId) == String(playerId)));
    let index = seat?.index ?? -1
    return index
}



