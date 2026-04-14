const mongoose = require("mongoose");
const roomSchema = mongoose.Schema({

    players: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        index: true
    }],
    friendMatch: {
        type: Boolean,
        default: false
    },
}, {
    timestamps: true
});

module.exports.model = mongoose.model("room", roomSchema);