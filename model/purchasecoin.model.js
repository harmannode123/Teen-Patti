const mongoose = require("mongoose");
const purchaseCoinSchema = mongoose.Schema({

    productId: {
        type: String,
        default: null
    },
    coins: {
        type: Number,
        default: 0
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        default: null
    },
    reciept: {
        type: String,
        default: null
    },
    type:{
        type:String,
        default:null
    },
    validUpto:{
        type:Date,
        default:null
    }

}, {
    timestamps: true
});

module.exports.model = mongoose.model("purchaseCoin", purchaseCoinSchema);