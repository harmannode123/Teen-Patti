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
    // Operator ko "active" callback (socket connect pe) SUCCESS ke saath pahunch
    // gaya ya nahi. False rahe to har naye connect pe dobara try hota hai —
    // isliye ise sirf operator ke success response pe hi true karna.
    sessionActive: {
        type: Boolean,
        default: false
    },
    // sessionExpiry: {
    //     type: Date,
    //     default: null
    // },
    disconnect: {
        type: Date,
        default: null
    },
    sendCallback: {
        type: Boolean,
        default: false
    },
     testUser: {
        type: Boolean,
        default: false
    },
}, {
    timestamps: true
});

// NOTE: yahan pehle userId pe UNIQUE partial index tha (`sessionClosed: false` par),
// taaki ek userId ka ek hi ACTIVE session ban sake. Testing me wo raaste me aa raha tha
// isliye HATA diya gaya hai (DB se bhi `db.users.dropIndex("userId_1")` se drop kiya gaya).
//
// Iska matlab: ab duplicate active session sirf `launch()` ke 409 check se rukta hai,
// jo race me kaafi nahi hai — do launch request bilkul saath me aayein to dono ka check
// pass ho sakta hai aur ek hi paise pe do session ban sakte hain. Live jaane se pehle
// ye index wapas lagana behtar hoga.
//
// Sirf lookup speed ke liye non-unique index rakha hai — `launch()` aur settlement dono
// `{ userId, sessionClosed }` pe query karte hain.
userSchema.index({ userId: 1, sessionClosed: 1 });

module.exports.model = mongoose.model("user", userSchema);