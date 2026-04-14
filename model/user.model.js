const mongoose = require("mongoose");
const userSchema = mongoose.Schema({

    id: {
        type: Number,
        default: null
    },
    name: {
        type: String,
        default: null
    },
    socketId: {
        type: String,
        default: null
    },
    avatar: {
        type: String,
        default: null
    },
    coins: {
        type: Number,
        default: 1000
    },
    joinRequest: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports.model = mongoose.model("user", userSchema);