// dependencies
const userSchema = require('../../model/user.model');
const gameSessionSchema = require('../../model/gameSession.model');
const matchSchema = require('../../model/match.model');
const utils = require('../../helper/utils');
const { responseStatus, callbackType } = require('../../helper/appConstant');
const { default: mongoose } = require('mongoose');
const axios = require('axios');
const { tryCatch } = require('bullmq');

// TEMPORARY (testing phase) — filhaal sirf in userIds ka game launch hoga, baaki sab 403.
// String rakhi hai jaan-boojh ke: request me userId string aata hai (validation bhi
// yup.string() hai), number rakhte to "2744836158" === 2744836158 false ho jaata aur
// allowed user bhi block ho jaata. Sabke liye kholna ho to is array ko KHALI kar do.
const LAUNCH_ALLOWED_USER_IDS = [
    "2744836158",
    "1613934275",
    "2886332125",
    "7894878286",
    //TEST USER
    "3782112868",
    "7472334845",
    "3829523755",
    "2827848229",
    "7898354436"

];

module.exports.launch = async (req, res, next) => {

    try {

        const { userId, userName, amount, currency, callbackUrl} = req.body;

        console.log("::::::::::::::::::::::",{ userId, userName, amount, currency, callbackUrl})

        // Allowlist check sabse pehle — DB touch karne se pehle hi reject ho jaye.
        if (LAUNCH_ALLOWED_USER_IDS.length && !LAUNCH_ALLOWED_USER_IDS.includes(String(userId))) {
            return res.status(responseStatus.forbidden).send({ success: false, message: "This user is not allowed to launch the game." });
        }

       if (!callbackUrl) return res.status(responseStatus.badRequest).send({ success: false, message: "callbackUrl missing." });
    //    const activeSession = await userSchema.model.findOne({ userId, sessionClosed: false });
    //    if (activeSession) return res.status(responseStatus.conflict).send({ success: false, message: "Session already active for this user." });
        const _id = new mongoose.Types.ObjectId();
        const sessionToken = utils.generateToken({ userId,_id});

        const gameUrl = `${process.env.GAME_BASE_URL}?token=${sessionToken}`;
        const user = await userSchema.model.create({
            _id,
            userId,
            name: userName || "Harry",
            // `finalCallbackUrl` variable upar comment ho chuka hai — yahan uska naam
            // reh jaata to har launch ReferenceError se 400 deta. Seedha env se lo.
            callbackUrl: callbackUrl,
            currency: currency || null,
            sessionToken:gameUrl,
            amount,
            coins: amount,
        });

        let launchOk = false;
        let operatorResponse = null;

        try {
            const response = await axios.post(callbackUrl, {
                type: callbackType.LAUNCH,
                sessionId: String(_id),
                userId,
                initialAmount: amount,
            }, { timeout: 3000 });
            operatorResponse = response.data;
            launchOk = response.data?.success === true && response.data?.message === "success";
        } catch (error) {
            operatorResponse = { error: error?.message };
        }

        // Operator ne haan nahi kaha -> session doc rakhna galat hai. Delete zaroori hai warna
        // `sessionClosed: false` wala doc pada rehta aur agla launch 409 se block ho jaata.
        if (!launchOk) {
            await userSchema.model.deleteOne({ _id });
            console.log("launch callback rejected =>", operatorResponse);
            return res.status(responseStatus.badRequest).send({ success: false, message: "Launch rejected by operator." });
        }

        // Unity build ka URL + token.

        return res.status(responseStatus.success).send({ success: true, gameUrl });
    }
    catch (error) {
        // Unique index (userId + sessionClosed:false) ne duplicate session roka — matlab do
        // launch request saath me aayi thi aur upar wala 409 check dono me pass ho gaya tha.
        // Client ko 500 nahi, wahi 409 milna chahiye.
        if (error?.code === 11000) return res.status(responseStatus.conflict).send({ success: false, message: "Session already active for this user." });
        return next(error);
    }
}

module.exports.gameHistory = async (req, res, next) => {

    try {

        const { userId } = req.body;
        // Validation number check kar chuka hai — yahan sirf defaults lagane hain.
        const limit = Number(req.body.limit) || 10;
        const offset = Number(req.body.offset) || 0;

        // Us user ke saare closed sessions (archive) — _id hi kaafi hai matches ke liye.
        const sessions = await gameSessionSchema.model
            .find({ userId: String(userId) ,netResult:{$ne:0}})
            .sort({ createdAt: -1 })
            .lean();

        if (!sessions.length) {
            return res.status(responseStatus.success).send({ success: true, sessions: [], total: 0, matches: [] });
        }

        const sessionIds = sessions.map((s) => s._id);

        const [total, matches] = await Promise.all([
            // BUG FIX: start:true `players: { $in }` ke ANDAR tha -> Mongo "unknown
            // operator: $start" error deta. Ye query-level field hai, bahar hona chahiye.
            matchSchema.model.countDocuments({ players: { $in: sessionIds }, start: true }),
            matchSchema.model
                .find({ players: { $in: sessionIds }, start: true })
                .sort({ createdAt: -1 })
                .skip(offset)
                .limit(limit)
                .lean(),
        ]);

        const sessionIdStrings = sessionIds.map((id) => String(id));

        const list = matches.map((m) => {

            // Is match me humara player (session) kaun sa tha.
            const player = m.playersData.find((pd) => sessionIdStrings.includes(String(pd.playerId)));
            const playerId = String(player?.playerId);

            // totalBet me boot bhi included hai -> player ka poora contribution.
            const totalBet = player?.totalBet || 0;

            // Player ne pot me se kitna wapas jeeta.
            let won = 0;

            if (m.pots?.length) {
                // ZHANDU all-in — har pot apne winners me equally banta tha.
                for (const p of m.pots) {
                    const winnerIds = (p.winners || []).map((w) => String(w));
                    if (winnerIds.includes(playerId)) won += Math.floor(p.amount / winnerIds.length);
                }
            } else if (m.draw) {
                // DRAW — pot non-packed players me equally split hua tha.
                const activePlayers = m.playersData.filter((pd) => !pd.isPacked);
                const activeIds = activePlayers.map((pd) => String(pd.playerId));
                if (activeIds.includes(playerId)) won = Math.floor(m.pot / activePlayers.length);
            } else if (String(m.winner) === playerId) {
                // Normal — winner ko pura pot.
                won = m.pot || 0;
            }

            return {
                matchId: m._id,
                game: `${m.roomName}/${m.variation}`,
                gameType: m.gameType,
                totalBet,
                won,
                profitLoss: won - totalBet,   // + profit / - loss
                isWinner: won > 0,
                pot: m.pot,
                playedAt: m.createdAt,
            };
        });

        return res.status(responseStatus.success).send({ success: true, sessions, total, list });
    }
    catch (error) { return next(error); }
}

module.exports.notifySessionActive = async (user) => {

    try {
        const freshUser = await userSchema.model.findOne({ _id: user._id }).lean();
        if (!freshUser || freshUser.sessionActive || freshUser?.coins<=0) return;

        const response = await axios.post(freshUser.callbackUrl, {
            type: callbackType.ACTIVE,
            sessionId: String(freshUser._id),
            userId: freshUser.userId,
            initialAmount: freshUser.amount,
        }, { timeout: 3000 });

        // Success ka criteria launch callback jaisa hi — dono me se kuch bhi
        // alag aaye to false hi maano, agla connect phir try karega.
        const activeOk = response.data?.success === true && response.data?.message === "success";
        if (activeOk) await userSchema.model.updateOne({ _id: user._id }, { sessionActive: true });
        else console.log("active callback rejected =>", user.userId, response.data);
    }
    catch (error) { console.log("active callback failed =>", error?.message); }
}

module.exports.notifyResult=async(session)=>{
   try {

    const initialAmount= session.amount ||0
    const finalAmount =  session.coins  ||0

        const payload = {
                        type: callbackType.RESULT,
                        sessionId: String(session?._id),
                        userId: session?.userId,
                        initialAmount,
                        finalAmount,
                        netResult:finalAmount - initialAmount,
                    };

        const response = await axios.post(session.callbackUrl,payload, { timeout: 3000 });

        const activeOk = response.data?.success === true && response.data?.message === "success";
        if (activeOk) await userSchema.model.updateOne({ _id: session?._id }, { sendCallback: true });
        else console.log("active callback rejected =>", response.data);
    }
    catch (error) { console.log("active callback failed =>", error?.message); }
}

