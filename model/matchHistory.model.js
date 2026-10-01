const mongoose = require("mongoose");
const { schema: matchSchema } = require("./match.model");

// Khatam ho chuke match ka DITTO copy yahan aata hai (startNextRound se).
// Schema match wala hi hai (clone), taaki match table me jo bhi field ho wo yahan bhi ho.
// `_id` bhi wahi rehta hai jo original match ka tha — history se match seedha map ho jaata hai.
const matchHistorySchema = matchSchema.clone();

// Admin panel ke "3D Games" reports (dashboard / gameplay list) date range + newest-first
// pe chalte hain — iske bina har report poori history scan + memory sort karti.
matchHistorySchema.index({ createdAt: -1 });

module.exports.model = mongoose.model("matchHistory", matchHistorySchema);
