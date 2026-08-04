// dependencies
const userSchema = require('../../model/user.model');
const utils = require('../../helper/utils');
const { responseStatus } = require('../../helper/appConstant');
const { default: mongoose } = require('mongoose');

module.exports.launch = async (req, res, next) => {

    try {

        const { userId, userName, amount, currency } = req.body;
        const finalCallbackUrl = process.env.OPERATOR_CALLBACK_URL;
        if (!finalCallbackUrl) return res.status(responseStatus.badRequest).send({ success: false, message: "callbackUrl missing (na request me, na env me)." });
        const activeSession = await userSchema.model.findOne({ userId, sessionClosed: false });
        if (activeSession) return res.status(responseStatus.conflict).send({ success: false, message: "Session already active for this user." });
        const _id = new mongoose.Types.ObjectId();
        const sessionToken = utils.generateToken({ userId,_id});

        const gameUrl = `${process.env.GAME_BASE_URL}?token=${sessionToken}`;
        const user = await userSchema.model.create({
            _id,
            userId,
            name: userName || "Harry",
            callbackUrl: finalCallbackUrl,
            currency: currency || null,
            sessionToken:gameUrl,
            amount,
            coins: amount,
        });

        // Unity build ka URL + token.

        return res.status(responseStatus.success).send({ success: true, gameUrl });
    }
    catch (error) { return next(error); }
}
