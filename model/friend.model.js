const mongoose = require("mongoose");
const friendSchema = mongoose.Schema({

    from: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    to: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    isAccepted: {
        type: Boolean,
        default: false
    },
    isBlock: {
        type: Boolean,
        default: false
    },
}, {
    timestamps: true
});

// indexing
friendSchema.index({ from: 1 });
friendSchema.index({ to: 1 });

module.exports.model = mongoose.model("friend", friendSchema);