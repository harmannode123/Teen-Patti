// Active match state cache (Redis).
//
// Problem (aapne khud bataya): har bet par 2 query + 2 populate Mongo se.
// Game chalte waqt match data baar-baar Mongo se padhna slow + DB par load.
//
// Solution: jab tak match CHAL raha hai, uska data Redis me rakho (RAM jaisa fast).
//   - read  -> Redis se (Mongo ko touch nahi karte)
//   - write -> Redis me turant, aur Mongo me background me (write-behind)
// Match khatam -> Redis se hata do (Mongo me final data already hai).
//
// Faayda: Mongo round-trips ~80% kam, aur cluster me sab process same Redis
// dekhenge to state consistent rahega.

const redis = require("./redis.helper");
const matchSchema = require("../model/match.model");

// Har match ke liye Redis key. TTL bhi rakhte hain taaki bhula hua match
// hamesha memory na ghere (safety net).
const matchKey = (matchId) => `match:${matchId}`;
const MATCH_TTL_SECONDS = 60 * 60; // 1 ghanta; har write par refresh ho jaata hai

// Match ko Redis me daalo (poora object JSON string banake).
// Redis sirf strings store karta hai, isliye JSON.stringify zaroori hai.
const setMatch = async (matchData) => {
    if (!matchData?._id) return;
    const key = matchKey(matchData._id);
    await redis.set(key, JSON.stringify(matchData), "EX", MATCH_TTL_SECONDS);
    return matchData;
};

// Match Redis se nikaalo. Agar Redis me hai -> turant wapas (FAST PATH).
// Agar Redis me nahi (server abhi restart hua, ya pehli baar) -> Mongo se laao
// aur Redis me daal do, taaki agli baar fast mile (cache warm-up / fallback).
const getMatch = async (matchId, { populate = false } = {}) => {
    const key = matchKey(matchId);
    const cached = await redis.get(key);

    if (cached) return JSON.parse(cached); // cache HIT -> Mongo touch nahi

    // cache MISS -> Mongo se laao
    let query = matchSchema.model.findOne({ _id: matchId });
    if (populate) {
        query = query
            .populate("players", "name socketId coins")
            .populate("watchers", "_id name socketId coins");
    }
    const fromDb = await query.lean();
    if (fromDb) await setMatch(fromDb); // cache me bhar do agli baar ke liye
    return fromDb;
};

// Write-behind: Redis me turant update karo (game ke liye yahi "sach" hai),
// aur Mongo me background me likho (await mat karo -> turn fast rahe).
// `fields` = sirf wo keys jo badli hain (jaise { pot, turn, playersData }).
const updateMatch = async (matchId, fields) => {
    const key = matchKey(matchId);
    const cached = await redis.get(key);
    if (!cached) return null;

    const matchData = JSON.parse(cached);
    Object.assign(matchData, fields); // purane data par nayi fields chadha do

    // 1) Redis turant update (synchronous, fast)
    await redis.set(key, JSON.stringify(matchData), "EX", MATCH_TTL_SECONDS);

    // 2) Mongo background update (await nahi -> response block nahi hoga).
    //    .catch zaroori hai warna unhandled promise rejection se crash ho sakta hai.
    matchSchema.model
        .updateOne({ _id: matchId }, { $set: fields })
        .catch((err) => console.log("write-behind error =>", err.message));

    return matchData;
};

// Match khatam -> Redis se hata do (Mongo me final state already hai).
const deleteMatch = async (matchId) => {
    await redis.del(matchKey(matchId));
};

module.exports = { setMatch, getMatch, updateMatch, deleteMatch, matchKey };
