const houseLedgerSchema = require("../model/houseLedger.model");

// Khatam hue match se house ledger entry — ek hi jagah se call hoti hai: startNextRound ka
// tail, jahan chaaron round-end raste (fold-win, show, side-show show, all-in showdown)
// aakhir me aate hain. `matchData` Mongo se FRESH hona chahiye (credit ke baad), taaki
// `commission` aur `payouts[]` poore hon. Upsert on matchId -> dobara chale to duplicate nahi.
module.exports.saveHouseLedger = async (matchData) => {
    if (!matchData?._id) return;

    const entry = {
        matchId: matchData._id,
        roomId: matchData.roomId,
        roomName: matchData.roomName,
        gameType: matchData.gameType,
        variation: matchData.variation,
        bootAmount: matchData.bootAmount || 0,
        pot: matchData.pot || 0,
        commission: matchData.commission || 0,
        winnerId: matchData.winner || null,
        isDraw: !!matchData.draw,
        winners: (matchData.payouts || []).map(p => ({
            playerId: p.playerId,
            amount: p.amount || 0,
            commission: p.commission || 0,
            potNo: p.potNo ?? null
        }))
    };

    await houseLedgerSchema.model.updateOne({ matchId: matchData._id }, { $setOnInsert: entry }, { upsert: true });
};
