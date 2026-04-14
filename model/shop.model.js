const mongoose = require("mongoose");
const shopSchema = mongoose.Schema({

    itemType: {
        type: String,
        default: null,
    },
    name: {
        type: String,
        default: null
    },
    coins: {
        type: Number,
        default:0
    },
    
}, {
    timestamps: true
});

module.exports.model = mongoose.model("shop", shopSchema);