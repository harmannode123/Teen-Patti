const mongoose = require("mongoose");


const playerDataSchema = mongoose.Schema({

    playerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
    },
    cards: {
        type: Array,
        default: []
    },
    turn: {
        type: Boolean,
        default: false
    },
    totalBet: {
        type: Number,
        default: 0
    },
    isSeen: {
        type: Boolean,
        default: false
    },
    // Kitne SEEN moves (seen hone ke baad kiye gaye bet) player ne kiye.
    // ZHANDU Section 6: side show tabhi jab requester ne >=1 seen move kiya ho.
    seenMoves: {
        type: Number,
        default: 0
    },
    isPacked: {
        type: Boolean,
        default: false
    },
    // ALL-IN (Phase 5): player ne apne saare bache coins laga diye. Bet nahi kar sakta
    // par showdown tak game me rehta. appliedJokers all-in ke waqt freeze hota hai.
    isAllIn: {
        type: Boolean,
        default: false
    },
    raise: {
        type: Boolean,
        default: false
    },
    index: {
        type: Number,
        default: null
    },
    // ZHANDU only: is player par abhi kitne joker apply hote hain.
    // Core me = jitne joker khule (sabke barabar). All-In phase me per-player
    // alag hoga (jaldi all-in karne wale ko kam joker). null = "saare opened".
    appliedJokers: {
        type: Number,
        default: null
    }

}, {
    timestamps: true
});

const seatPosition = mongoose.Schema({

    playerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
    },
    index: {
        type: Number,
        default: null
    },
}, {
    timestamps: true
});



const matchSchema = mongoose.Schema({

    players: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
    }],
    exitPlayers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
    }],
    watchers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
    }],
    start: {
        type: Boolean,
        default: false
    },
    end: {
        type: Boolean,
        default: false
    },
    draw: {
        type: Boolean,
        default: false
    },
    winner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    previousWinner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    roomId: {
        type: String,
        default: null
    },
    roomName: {
        type: String,
        default: null
    },
    gameType: {
        type: String,
        //  enum: ["teenpatti", "muflis", "joker", "fourcard", "twocard", "zhandu"],
        default: "teenpatti"
    },
    variation: {
        type: String,
        //  enum: ["teenpatti", "muflis", "joker", "fourcard", "twocard", "zhandu"],
        default: "Bronze"
    },
    // Joker variant only: the card cut from the deck before dealing.
    // Its rank (cardValue) becomes the wild card for this match.
    jokerCard: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    // ZHANDU only: 3 center cards cut from deck, ek-ek karke khulte hain.
    // har entry { card: <cardObj>, opened: Boolean }. opened jokers ke
    // cardValue wild ban jaate hain. J1 boot ke baad, J2 round-1 ke baad,
    // J3 round-2 ke baad open hota hai.
    jokerCards: {
        type: [
            {
                card: { type: mongoose.Schema.Types.Mixed, default: null },
                opened: { type: Boolean, default: false }
            }
        ],
        default: []
    },
    // ZHANDU only: dealer button wala player. Round "complete" hua ya nahi
    // isi se decide hota hai (button act/fold -> round complete -> agla joker).
    // Show rules bhi button ke left/right pe depend karte hain.
    dealerButton: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    // ZHANDU only: kitne "round of moves" complete ho chuke (0,1,2,3).
    // 1 complete -> J2 khula, 2 complete -> J3 khula.
    movesRound: {
        type: Number,
        default: 0
    },
    playersData: [playerDataSchema],
    seatPosition: [seatPosition],
    pot: {
        type: Number,
        default: 0
    },
    // Match start pe PER-USER kitna boot liya gaya (e.g. sabse 1000 -> bootAmount = 1000).
    // Baad me pata chal sake ki is match ka starting boot kitna tha.
    bootAmount: {
        type: Number,
        default: 0
    },
    currentBetAmount: {
        type: Number,
        default: 0
    },
    entryAmount:{
        type: Number,
        default: 0
    },
    betLimit:{
        type: Number,
        default: 0
    },
    sideShow: {
        type: Boolean,
        default: false
    },
    show: {
        type: Boolean,
        default: false
    },
    moveTimer: {
        type: Number,
        default: 0
    },
    turn: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    record: {
        type: Array,
        default: []
    },
    sideShowUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
    },
    round: {
        type: Number,
        default: 1
    },
    scoresData: {
        type: Array,
        default: []
    },
    matchResult: {
        type: String,
        default: null
    },
    // ALL-IN (Phase 5): showdown pe bane main + side pots ka record.
    // Har entry: kis pot me kitna, kaun eligible tha, kisne jeeta, kis hand se.
    pots: {
        type: [
            {
                potNo: Number,
                amount: Number,
                eligible: [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
                winners: [{ type: mongoose.Schema.Types.ObjectId, ref: "user" }],
                hand: String
            }
        ],
        default: []
    },
    waitForNextRount: {
        type: Boolean,
        default: false
    },
}, {
    timestamps: true
});


// SABSE HOT: har bet pe DO baar chalti hai — placeBet/sideShow ka lock lookup aur uske
// baad data query, dono `{ start: true, end: false, turn: userId }` se match dhoondhti hain.
// `turn` pehle isliye ki wahi sabse selective hai (ek time ek hi match me ek banda turn pe
// hota); start/end boolean hain, akele me kuch filter nahi karte.
matchSchema.index({ turn: 1, start: 1, end: 1 });

// Player ka "current match" nikalna — seenCard (×2), resyncMatch, selfExit, fetchBestHand,
// sab `{ players: userId, end: false }` + `sort({ createdAt: -1 })` karte hain
// (room = match chain, isliye hamesha newest chahiye).
// `end` andar isliye ki wo HAR player-query me hai -> Mongo seedha (user, end:false) block
// pe jump karta hai; banda kisi match me na ho to wo block khali = turant jawab, uski poorise
// match history walk nahi karni padti (disconnect storm me yahi bachata hai).
// `start` jaan bujh ke NAHI: wo sirf kuch queries me aata hai, aur beech me hone se baaki
// queries ke liye `createdAt` sort index se nahi ho paata -> memory sort wapas aa jaata.
// `createdAt: -1` isliye taaki sort bhi index se ho.
// `players` array hai par compound me sirf yahi array field hai -> multikey allowed.
matchSchema.index({ players: 1, end: 1, createdAt: -1 });

module.exports.model = mongoose.model("match", matchSchema);