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
        default: false
    },
    isSeen: {
        type: Boolean,
        default: false
    },
    isPacked: {
        type: Boolean,
        default: false
    }
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
    room: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "room",
        default: null
    },
    playersData: [playerDataSchema],

    pot: {
        type: Number,
        default: 0
    },
    currentBetAmount: {
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
}, {
    timestamps: true
});


module.exports.model = mongoose.model("match", matchSchema);