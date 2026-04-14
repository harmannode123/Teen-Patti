const mongoose = require("mongoose");
const purchseItemSchema = mongoose.Schema({

    shopId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "shop",
        default: null
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    count: {
        type: Number,
        default: 0
    }

}, {
    timestamps: true
});

module.exports.model = mongoose.model("purchaseItem", purchseItemSchema);