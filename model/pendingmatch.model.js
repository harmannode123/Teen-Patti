const mongoose = require("mongoose");
const pendingMatches = mongoose.Schema({
    matchDetail: {
        type: Object,
        required: true
    },
    completed: {
        type: Boolean,
        default: false
    },
    trumpSuitToPlayed: {
        type: String,
        default: null
    },
    differenceMatch: {
        type: Boolean,
        default: false
    }

}, {
    timestamps: true
});

module.exports.model = mongoose.model("pendingMatches", pendingMatches);