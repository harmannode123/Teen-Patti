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

// Ek userId ka ek hi ACTIVE session. `launch()` ka 409 check apne aap me kaafi nahi hai —
// do launch request saath me aayein to dono ka check pass ho jaata (dono ko active session
// nahi milta) aur do session ban jaate = ek hi paise pe do balance. Ye index DB level pe
// dusre doc ko reject kar deta hai.
// `partialFilterExpression` isliye: settle ho chuke (sessionClosed: true) session pade rehte
// hain, unpe unique lagana galat hoga — ek user kai baar khel sakta hai.
userSchema.index(
    { userId: 1 },
    { unique: true, partialFilterExpression: { sessionClosed: false } }
);

module.exports.model = mongoose.model("user", userSchema);