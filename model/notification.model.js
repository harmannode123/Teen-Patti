const mongoose = require('mongoose');
const notificationSchema = new mongoose.Schema({

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
    title: {
        type: String,
        default: null
    },
    description: {
        type: String,
        default: null
    },
    announcement: {
        type: Boolean,
        default: false
    },
    seen: {
        type: Boolean,
        default: false
    },
    type: {
        type: String,
        default: null
    }
}, { timestamps: true });

notificationSchema.index({ to: 1 })

module.exports.model = mongoose.model('notification', notificationSchema)
