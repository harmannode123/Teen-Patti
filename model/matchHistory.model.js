const mongoose = require("mongoose");
const { schema: matchSchema } = require("./match.model");

// Khatam ho chuke match ka DITTO copy yahan aata hai (startNextRound se).
// Schema match wala hi hai (clone), taaki match table me jo bhi field ho wo yahan bhi ho.
// `_id` bhi wahi rehta hai jo original match ka tha — history se match seedha map ho jaata hai.
const matchHistorySchema = matchSchema.clone();

module.exports.model = mongoose.model("matchHistory", matchHistorySchema);
