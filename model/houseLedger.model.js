const mongoose = require("mongoose");

// HOUSE LEDGER: platform (house) ka hisaab — har khatam hue match ki EK entry.
// Pot kitna tha, house ko commission (profit) kitna mila, kis-kis winner ko kitna mila
// aur usse kitna kata. Entry `saveHouseLedger` (helper/houseLedger.helper.js) banata hai,
// data match ke `payouts[]` se aata hai jo credit helpers round-end pe bharte hain.
const winnerSchema = mongoose.Schema({
    playerId: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    amount: { type: Number, default: 0 },       // commission kaat ke jitna credit hua
    commission: { type: Number, default: 0 },   // is winner ke hisse se jitna house ne kaata
    potNo: { type: Number, default: null }      // showdown side pots me kaunsa pot (warna null)
}, { _id: false });

const houseLedgerSchema = mongoose.Schema({
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: "match", required: true, unique: true },
    roomId: { type: String, default: null },
    roomName: { type: String, default: null },
    gameType: { type: String, default: null },
    variation: { type: String, default: null },
    bootAmount: { type: Number, default: 0 },
    pot: { type: Number, default: 0 },           // poora pot (winners ko mila + commission)
    commission: { type: Number, default: 0 },    // house ka profit is match se
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: "user", default: null }, // main winner
    isDraw: { type: Boolean, default: false },
    winners: { type: [winnerSchema], default: [] }
}, {
    timestamps: true
});

module.exports.model = mongoose.model("houseLedger", houseLedgerSchema);
