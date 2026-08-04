const mongoose = require("mongoose");

// Closed session ka archive — jab user session close karta hai, active user doc ka
// pura record yaha aa jaata hai (history). user table sirf active docs rakhta hai.
const gameSessionSchema = mongoose.Schema({

    // Kis user (operator) ki session
    userId: {
        type: String,
        default: null
    },
    name: {
        type: String,
        default: null
    },
    callbackUrl: {
        type: String,
        default: null
    },
    currency: {
        type: String,
        default: null
    },
    sessionToken: {
        type: String,
        default: null
    },

    // Launch pe reserve kiya amount
    startAmount: {
        type: Number,
        default: 0
    },
    // Session close pe bacha hua balance
    finalCoins: {
        type: Number,
        default: 0
    },
    // finalCoins - startAmount (+ profit / - loss)
    netResult: {
        type: Number,
        default: 0
    },
    settlement: {
        type: Boolean,
        default: false
    },
    sendCallback: {
        type: Boolean,
        default: false
    },
    // Kitni baar callback try kiya. Operator down ho to ye badhta rahega.
    callbackAttempts: {
        type: Number,
        default: 0
    },
    lastCallbackAt: {
        type: Date,
        default: null
    },
    // Operator ne kya bheja (ya error) — debugging ke liye.
    operatorResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    launchedAt: {
        type: Date,
        default: null
    },
    closedAt: {
        type: Date,
        default: null
    },

}, {
    timestamps: true
});

module.exports.model = mongoose.model("gameSession", gameSessionSchema);
