const mongoose = require("mongoose");
const adminSchema = mongoose.Schema({

    email: {
        type: String,
        default: null,
        lowercase: true
    },
    password: {
        type: String,
        default: null
    },
    forgotPasswordToken: {
        type: String,
        default: null
    },
    deviceType: {
        type: String,
        default: null
    },
    deviceToken: {
        type: String,
        default: null
    },
}, {
    timestamps: true
});

module.exports.model = mongoose.model("admin", adminSchema);