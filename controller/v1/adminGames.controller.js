// ADMIN PANEL -> "3D Games" tab ke saare APIs.
//
// Data ka source `matchHistory` hai (har khatam hua round ka ditto copy) — usme `pot`
// (us round ka total collection), `commission` (house ka 5% cut) aur `payouts[]` (kis winner
// ko kitna mila) already hain. houseLedger jaan-boojh ke use NAHI kiya: wo baad me aaya tha,
// isliye usme purane rounds nahi hain aur totals kam aate.
//
// "Game" = lobby ka room, gameType nahi: Variation room me gameType har round badalta hai
// (teenpatti/zhandu/flipper), isliye sirf gameType pe group karte to Variation ke rounds
// baaki teeno me mil jaate. `vMode: true` -> "variation", warna gameType.
const matchSchema = require("../../model/match.model");
const matchHistorySchema = require("../../model/matchHistory.model");
const userSchema = require("../../model/user.model");
const gameSessionSchema = require("../../model/gameSession.model");
const utils = require("../../helper/utils");
const { responseStatus, roomList } = require("../../helper/appConstant");

const COMMISSION_PERCENT = Number(process.env.COMMISSION_PERCENT) || 5;
const DEFAULT_TZ = "Asia/Kolkata";

// roomList se hi banta hai -> naya game add hua to yahan apne aap aa jayega.
const GAMES = roomList.map((g) => ({ key: g.vMode ? "variation" : g.gameType, name: g.name }));

const gameKeyExpr = { $cond: [{ $eq: ["$vMode", true] }, "variation", "$gameType"] };
const gameKeyOf = (m) => (m.vMode ? "variation" : m.gameType);
const gameNameOf = (key) => GAMES.find((g) => g.key === key)?.name || key;

const gameFilter = (game) => {
    if (!game) return {};
    return game === "variation" ? { vMode: true } : { vMode: { $ne: true }, gameType: game };
};

// "2026-10-01" jaisi date-only string ko admin ke timezone ke din ki shuruaat maano —
// seedha `new Date()` karte to wo UTC midnight ban jaata aur IST me din 5:30 ghante khisak jaata.
const tzOffsetMs = (date, tz) => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
};

const parseDate = (value, tz, endOfDay) => {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const utc = new Date(`${value}T00:00:00.000Z`);
        const start = new Date(utc.getTime() - tzOffsetMs(utc, tz));
        return endOfDay ? new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1) : start;
    }
    const d = new Date(value);
    return isNaN(d) ? null : d;
};

// from/to/game -> matchHistory ka common filter. `start: true` isliye ki bina shuru hue
// (koi baitha hi nahi) match ka paisa/gameplay kuch nahi hota.
const buildFilter = (query) => {
    const tz = query.tz || DEFAULT_TZ;
    const from = parseDate(query.from, tz, false);
    const to = parseDate(query.to, tz, true);
    const filter = { start: true, ...gameFilter(query.game) };
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    return { filter, from, to, tz };
};

const pagination = (query) => ({
    limit: Math.min(Number(query.limit) || 20, 100),
    offset: Number(query.offset) || 0
});

// players[] me SESSION ki _id hoti hai (operator ka userId nahi). Session chalu ho to `users`
// me milta hai, settle hone ke baad wahi _id `gamesessions` me chala jaata hai — isliye dono
// jagah dekhna padta hai. Wapas: Map(sessionId -> { userId, name }).
const resolvePlayers = async (ids) => {
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    if (!unique.length) return new Map();
    const [active, archived] = await Promise.all([
        userSchema.model.find({ _id: { $in: unique } }).select("userId name testUser").lean(),
        gameSessionSchema.model.find({ _id: { $in: unique } }).select("userId name").lean()
    ]);
    const map = new Map();
    for (const row of [...archived, ...active]) map.set(String(row._id), { userId: row.userId, name: row.name, testUser: !!row.testUser });
    return map;
};

// Wahi kaam aggregation ke andar: `sessionField` (ObjectId) se operator ka userId/name nikaalo.
// Dono me na mile (bahut purana/delete hua session) to session id hi userId maan lo, taaki
// uske rounds totals se gayab na hon.
const identityStages = (sessionField) => ([
    { $lookup: { from: userSchema.model.collection.name, localField: sessionField, foreignField: "_id", pipeline: [{ $project: { userId: 1, name: 1 } }], as: "_u" } },
    { $lookup: { from: gameSessionSchema.model.collection.name, localField: sessionField, foreignField: "_id", pipeline: [{ $project: { userId: 1, name: 1 } }], as: "_s" } },
    {
        $addFields: {
            uid: { $ifNull: [{ $first: "$_u.userId" }, { $first: "$_s.userId" }, { $toString: `$${sessionField}` }] },
            uname: { $ifNull: [{ $first: "$_u.name" }, { $first: "$_s.name" }] }
        }
    },
    { $project: { _u: 0, _s: 0 } }
]);

const moneyGroup = {
    rounds: { $sum: 1 },
    totalCollection: { $sum: "$pot" },
    commission: { $sum: "$commission" },
    draws: { $sum: { $cond: ["$draw", 1, 0] } }
};

const withPayout = (row = {}) => {
    const totalCollection = row.totalCollection || 0;
    const commission = row.commission || 0;
    return {
        rounds: row.rounds || 0,
        totalCollection,                               // sab players ne pot me kitna daala (boot + bets)
        commission,                                    // house (inhouse) ka hissa
        payout: totalCollection - commission,          // winners ko wapas gaya
        draws: row.draws || 0
    };
};

// Ek player ka ek round ka hisaab. Naye rounds me payouts[] hai (commission kat ke actual
// credit). Usse pehle ke rounds me match pe `commission` to kata tha par payouts[] record
// nahi hota tha — wahan jeet ka hissa pot/pots/draw se nikaal ke commission usi anupaat me
// ghatate hain, warna winner ko poora pot dikhta jabki mila 5% kam tha.
const playerResult = (match, playerId) => {
    const id = String(playerId);
    const payouts = match.payouts || [];
    if (payouts.length) {
        let won = 0;
        let commission = 0;
        for (const p of payouts) {
            if (String(p.playerId) !== id) continue;
            won += p.amount || 0;
            commission += p.commission || 0;
        }
        return { won, commission };
    }

    let gross = 0;
    if (match.pots?.length) {
        for (const p of match.pots) {
            const winnerIds = (p.winners || []).map(String);
            if (winnerIds.includes(id)) gross += Math.floor(p.amount / winnerIds.length);
        }
    } else if (match.draw) {
        const active = (match.playersData || []).filter((pd) => !pd.isPacked);
        if (active.some((pd) => String(pd.playerId) === id)) gross = Math.floor((match.pot || 0) / active.length);
    } else if (String(match.winner) === id) {
        gross = match.pot || 0;
    }
    const commission = match.pot ? Math.round((match.commission || 0) * gross / match.pot) : 0;
    return { won: gross - commission, commission };
};

// GET /admin/3d-games/dashboard?from&to&game&tz
// Tab ka main screen: overall totals, chaaro games ka alag hisaab, tier (Bronze..Diamond)
// breakdown, din-wise trend, aaj ka hisaab aur abhi live kya chal raha hai.
module.exports.dashboard = async (req, res, next) => {

    try {

        const { filter, from, to, tz } = buildFilter(req.query);
        const todayStart = parseDate(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()), tz, false);

        const [facets, players, todayRows, liveMatches] = await Promise.all([
            matchHistorySchema.model.aggregate([
                { $match: filter },
                { $addFields: { game: gameKeyExpr } },
                {
                    $facet: {
                        games: [{ $group: { _id: "$game", ...moneyGroup, lastPlayedAt: { $max: "$createdAt" } } }],
                        tiers: [{ $group: { _id: { game: "$game", tier: "$variation", bootAmount: "$bootAmount" }, ...moneyGroup } }],
                        daily: [
                            { $group: { _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: tz } }, game: "$game" }, ...moneyGroup } },
                            { $sort: { "_id.date": 1 } }
                        ]
                    }
                }
            ]),
            // Unique players — session nahi, operator ka userId gino (ek banda 10 session
            // banaye to bhi 1 hi player hai).
            matchHistorySchema.model.aggregate([
                { $match: filter },
                { $project: { game: gameKeyExpr, players: "$playersData.playerId" } },
                { $unwind: "$players" },
                { $group: { _id: { game: "$game", player: "$players" } } },
                { $project: { _id: 0, game: "$_id.game", player: "$_id.player" } },
                ...identityStages("player"),
                { $group: { _id: { game: "$game", uid: "$uid" } } },
                {
                    $facet: {
                        perGame: [{ $group: { _id: "$_id.game", count: { $sum: 1 } } }],
                        total: [{ $group: { _id: "$_id.uid" } }, { $count: "count" }]
                    }
                }
            ]),
            matchHistorySchema.model.aggregate([
                { $match: { start: true, ...gameFilter(req.query.game), createdAt: { $gte: todayStart } } },
                { $group: { _id: null, ...moneyGroup } }
            ]),
            // Abhi jin tables pe koi baitha hai (live `match` collection, history nahi).
            matchSchema.model.find({ end: false, "players.0": { $exists: true }, ...gameFilter(req.query.game) })
                .select("gameType vMode start players watchers pot").lean()
        ]);

        const { games: gameRows, tiers: tierRows, daily: dailyRows } = facets[0];
        const uniqueByGame = new Map((players[0]?.perGame || []).map((r) => [r._id, r.count]));

        const games = GAMES
            .filter((g) => !req.query.game || g.key === req.query.game)
            .map((g) => {
                const row = gameRows.find((r) => r._id === g.key);
                const live = liveMatches.filter((m) => gameKeyOf(m) === g.key);
                return {
                    game: g.key,
                    name: g.name,
                    ...withPayout(row),
                    uniquePlayers: uniqueByGame.get(g.key) || 0,
                    lastPlayedAt: row?.lastPlayedAt || null,
                    live: {
                        runningTables: live.filter((m) => m.start).length,
                        waitingTables: live.filter((m) => !m.start).length,
                        players: live.reduce((n, m) => n + m.players.length, 0),
                        watchers: live.reduce((n, m) => n + (m.watchers?.length || 0), 0),
                        potOnTables: live.reduce((n, m) => n + (m.pot || 0), 0)
                    },
                    tiers: tierRows
                        .filter((t) => t._id.game === g.key)
                        .sort((a, b) => (a._id.bootAmount || 0) - (b._id.bootAmount || 0))
                        .map((t) => ({ tier: t._id.tier, bootAmount: t._id.bootAmount, ...withPayout(t) }))
                };
            });

        const sum = (key) => games.reduce((n, g) => n + g[key], 0);
        const sumLive = (key) => games.reduce((n, g) => n + g.live[key], 0);

        // Din-wise: har din ka total + us din ka game-wise breakdown (chart ke liye).
        const dailyMap = new Map();
        for (const row of dailyRows) {
            const date = row._id.date;
            if (!dailyMap.has(date)) dailyMap.set(date, { date, rounds: 0, totalCollection: 0, commission: 0, payout: 0, games: {} });
            const day = dailyMap.get(date);
            const money = withPayout(row);
            day.rounds += money.rounds;
            day.totalCollection += money.totalCollection;
            day.commission += money.commission;
            day.payout += money.payout;
            day.games[row._id.game] = { rounds: money.rounds, totalCollection: money.totalCollection, commission: money.commission };
        }

        return res.status(responseStatus.success).json(utils.createSuccessResponse("dashboardFetched", {
            range: { from, to, tz },
            commissionPercent: COMMISSION_PERCENT,
            totals: {
                rounds: sum("rounds"),
                totalCollection: sum("totalCollection"),
                commission: sum("commission"),
                payout: sum("payout"),
                draws: sum("draws"),
                uniquePlayers: players[0]?.total?.[0]?.count || 0
            },
            today: withPayout(todayRows[0]),
            live: {
                runningTables: sumLive("runningTables"),
                waitingTables: sumLive("waitingTables"),
                players: sumLive("players"),
                watchers: sumLive("watchers"),
                potOnTables: sumLive("potOnTables")
            },
            games,
            daily: [...dailyMap.values()]
        }));
    }
    catch (error) { return next(error); }
};

// GET /admin/3d-games/gameplay?game&from&to&userId&roomId&limit&offset
// Round-wise game play: har round me kaun khela, kisne kitna lagaya, kaun jeeta,
// house ko kitna mila. Newest pehle.
module.exports.gameplay = async (req, res, next) => {

    try {

        const { filter } = buildFilter(req.query);
        const { limit, offset } = pagination(req.query);
        if (req.query.roomId) filter.roomId = String(req.query.roomId);

        // userId operator ka hota hai -> pehle uske saare session ids nikaalo.
        if (req.query.userId) {
            const userId = String(req.query.userId);
            const [active, archived] = await Promise.all([
                userSchema.model.find({ userId }).distinct("_id"),
                gameSessionSchema.model.find({ userId }).distinct("_id")
            ]);
            filter.players = { $in: [...active, ...archived] };
        }

        const [total, matches] = await Promise.all([
            matchHistorySchema.model.countDocuments(filter),
            matchHistorySchema.model.find(filter)
                .select("roomId roomName gameType vMode variation bootAmount pot commission payouts pots draw winner playersData createdAt updatedAt")
                .sort({ createdAt: -1 }).skip(offset).limit(limit).lean()
        ]);

        const identities = await resolvePlayers(matches.flatMap((m) => (m.playersData || []).map((pd) => pd.playerId)));

        const list = matches.map((m) => {
            const game = gameKeyOf(m);
            const players = (m.playersData || []).map((pd) => {
                const identity = identities.get(String(pd.playerId)) || {};
                const { won, commission } = playerResult(m, pd.playerId);
                const totalBet = pd.totalBet || 0;     // boot included
                return {
                    sessionId: pd.playerId,
                    userId: identity.userId || null,
                    name: identity.name || null,
                    seat: pd.index,
                    totalBet,
                    won,                               // commission kat ke actual credit
                    commission,
                    profitLoss: won - totalBet,
                    isWinner: won > 0,
                    isPacked: !!pd.isPacked,
                    isSeen: !!pd.isSeen,
                    isAllIn: !!pd.isAllIn,
                    cards: (pd.cards || []).map((c) => c.cardId)
                };
            });
            return {
                matchId: m._id,
                game,
                gameName: gameNameOf(game),
                gameType: m.gameType,                  // Variation room me us round ka asli variant
                roomId: m.roomId,
                tier: m.variation,
                bootAmount: m.bootAmount || 0,
                totalCollection: m.pot || 0,
                commission: m.commission || 0,
                payout: (m.pot || 0) - (m.commission || 0),
                isDraw: !!m.draw,
                playerCount: players.length,
                winners: players.filter((p) => p.isWinner).map((p) => ({ userId: p.userId, name: p.name, won: p.won })),
                players,
                playedAt: m.createdAt,
                endedAt: m.updatedAt
            };
        });

        return res.status(responseStatus.success).json(utils.createSuccessResponse("dashboardFetched", { total, limit, offset, list }));
    }
    catch (error) { return next(error); }
};

// GET /admin/3d-games/users?game&from&to&search&sortBy&order&limit&offset
// Kaun-kaun khela: operator userId ke hisaab se rounds, total bet, jeet, P/L aur
// us user ki jeet se house ko kitna commission mila.
module.exports.users = async (req, res, next) => {

    try {

        const { filter } = buildFilter(req.query);
        const { limit, offset } = pagination(req.query);
        const sortBy = req.query.sortBy || "totalBet";
        const order = req.query.order === "asc" ? 1 : -1;
        const search = req.query.search ? String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;

        const result = await matchHistorySchema.model.aggregate([
            { $match: filter },
            { $addFields: { game: gameKeyExpr } },
            { $unwind: "$playersData" },
            {
                $project: {
                    game: 1,
                    createdAt: 1,
                    player: "$playersData.playerId",
                    totalBet: { $ifNull: ["$playersData.totalBet", 0] },
                    mine: { $filter: { input: { $ifNull: ["$payouts", []] }, cond: { $eq: ["$$this.playerId", "$playersData.playerId"] } } },
                    // payouts[] se pehle ke rounds: winner ko pot mila, usme se match ka commission kata.
                    legacyWinner: { $and: [{ $eq: [{ $size: { $ifNull: ["$payouts", []] } }, 0] }, { $eq: ["$winner", "$playersData.playerId"] }, { $ne: ["$draw", true] }] },
                    pot: { $ifNull: ["$pot", 0] },
                    matchCommission: { $ifNull: ["$commission", 0] }
                }
            },
            {
                $addFields: {
                    won: { $add: [{ $sum: "$mine.amount" }, { $cond: ["$legacyWinner", { $subtract: ["$pot", "$matchCommission"] }, 0] }] },
                    commission: { $add: [{ $sum: "$mine.commission" }, { $cond: ["$legacyWinner", "$matchCommission", 0] }] }
                }
            },
            // Pehle session pe group, phir identity lookup — har round-row pe lookup nahi karna.
            {
                $group: {
                    _id: "$player",
                    rounds: { $sum: 1 },
                    wins: { $sum: { $cond: [{ $gt: ["$won", 0] }, 1, 0] } },
                    totalBet: { $sum: "$totalBet" },
                    won: { $sum: "$won" },
                    commission: { $sum: "$commission" },
                    games: { $addToSet: "$game" },
                    firstPlayed: { $min: "$createdAt" },
                    lastPlayed: { $max: "$createdAt" }
                }
            },
            { $addFields: { player: "$_id" } },
            ...identityStages("player"),
            {
                $group: {
                    _id: "$uid",
                    name: { $max: "$uname" },
                    sessions: { $sum: 1 },
                    rounds: { $sum: "$rounds" },
                    wins: { $sum: "$wins" },
                    totalBet: { $sum: "$totalBet" },
                    won: { $sum: "$won" },
                    commission: { $sum: "$commission" },
                    games: { $push: "$games" },
                    firstPlayed: { $min: "$firstPlayed" },
                    lastPlayed: { $max: "$lastPlayed" }
                }
            },
            ...(search ? [{ $match: { $or: [{ _id: { $regex: search, $options: "i" } }, { name: { $regex: search, $options: "i" } }] } }] : []),
            {
                $project: {
                    _id: 0,
                    userId: "$_id",
                    name: 1, sessions: 1, rounds: 1, wins: 1, totalBet: 1, won: 1, commission: 1, firstPlayed: 1, lastPlayed: 1,
                    losses: { $subtract: ["$rounds", "$wins"] },
                    profitLoss: { $subtract: ["$won", "$totalBet"] },
                    games: { $reduce: { input: "$games", initialValue: [], in: { $setUnion: ["$$value", "$$this"] } } }
                }
            },
            {
                $facet: {
                    total: [{ $count: "count" }],
                    list: [{ $sort: { [sortBy]: order, userId: 1 } }, { $skip: offset }, { $limit: limit }]
                }
            }
        ]);

        return res.status(responseStatus.success).json(utils.createSuccessResponse("dashboardFetched", {
            total: result[0]?.total?.[0]?.count || 0,
            limit,
            offset,
            list: result[0]?.list || []
        }));
    }
    catch (error) { return next(error); }
};

// GET /admin/3d-games/live?game
// Abhi chal rahi tables — kaun baitha hai, pot kitna hai. Cards jaan-boojh ke NAHI bhejte:
// chalte round ke cards admin panel se leak hue to game hi toot jaata hai.
module.exports.live = async (req, res, next) => {

    try {

        const matches = await matchSchema.model.find({ end: false, "players.0": { $exists: true }, ...gameFilter(req.query.game) })
            .select("roomId roomName gameType vMode variation bootAmount pot start players watchers playersData turn currentBetAmount createdAt")
            .sort({ start: -1, createdAt: -1 }).lean();

        const identities = await resolvePlayers(matches.flatMap((m) => m.players));

        const list = matches.map((m) => {
            const game = gameKeyOf(m);
            return {
                matchId: m._id,
                game,
                gameName: gameNameOf(game),
                gameType: m.gameType,
                roomId: m.roomId,
                tier: m.variation,
                bootAmount: m.bootAmount || 0,
                status: m.start ? "running" : "waiting",
                pot: m.pot || 0,
                currentBetAmount: m.currentBetAmount || 0,
                watchers: m.watchers?.length || 0,
                players: m.players.map((id) => {
                    const identity = identities.get(String(id)) || {};
                    const pd = (m.playersData || []).find((p) => String(p.playerId) === String(id));
                    return {
                        sessionId: id,
                        userId: identity.userId || null,
                        name: identity.name || null,
                        totalBet: pd?.totalBet || 0,
                        isPacked: !!pd?.isPacked,
                        isSeen: !!pd?.isSeen,
                        isAllIn: !!pd?.isAllIn,
                        isTurn: !!m.turn && String(m.turn) === String(id)
                    };
                }),
                startedAt: m.createdAt
            };
        });

        return res.status(responseStatus.success).json(utils.createSuccessResponse("dashboardFetched", { total: list.length, list }));
    }
    catch (error) { return next(error); }
};
