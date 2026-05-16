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
    isPacked: {
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
    roomId: {
        type: String,
        default: null
    },
    roomName: {
        type: String,
        default: null
    },
    playersData: [playerDataSchema],
    seatPosition: [seatPosition],
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
    waitForNextRount: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

matchSchema.index({ roomId: 1, players: 1 });

module.exports.model = mongoose.model("match", matchSchema);