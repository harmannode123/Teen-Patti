const mongoose = require("mongoose");
const userSchema = mongoose.Schema({

    name: {
        type: String,
        default: null
    },
    socketId: {
        type: String,
        default: null
    },
    coins: {
        type: Number,
        default: 1000
    },
    userId: {
        type: String,
        required: true
    },
    // Result/settle callback yaha POST karenge
    callbackUrl: {
        type: String,
        required: true
    },
    currency: {
        type: String,
        default: null
    },
    sessionToken: {
        type: String,
        default: null
    },
    amount: {
        type: Number,
        default: 0
    },
    // active = game chal raha, closed = settle ho gaya
    sessionClosed: {
        type: Boolean,
        default: false
    },
    sessionExpiry: {
        type: Date,
        default: null
    },
    disconnect: {
        type: Date,
        default: null
    },

}, {
    timestamps: true
});

module.exports.model = mongoose.model("user", userSchema);