// dependencies
const userSchema = require('../../model/user.model');
const utils = require('../../helper/utils');
const { responseStatus, callbackType } = require('../../helper/appConstant');
const { default: mongoose } = require('mongoose');
const axios = require('axios');

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

        let launchOk = false;
        let operatorResponse = null;

        try {
            const response = await axios.post(finalCallbackUrl, {
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
