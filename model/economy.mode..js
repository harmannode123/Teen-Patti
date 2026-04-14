const mongoose = require("mongoose");
const economySchema = mongoose.Schema({

    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    matchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    betAmount: {
        type: Number,
        default: 0
    },
}, {
    timestamps: true
});

// indexing
economySchema.index({ user: 1 });

module.exports.model = mongoose.model("economy", economySchema);