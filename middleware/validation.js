// Dependencies
const yup = require("yup");
const { responseStatus, messagesEnglish } = require("../helper/appConstant");
const utils = require("../helper/utils");

module.exports.socialSigninValidation = async (req, res, next) => {

    try {

        await yup.object({

            fcmToken: yup.string().trim().required(),
            deviceToken: yup.string().trim().required(),
            deviceType: yup.string().required().oneOf(['ios', 'android', 'web']),
            socialId: yup.string().trim().required(),
            socialType: yup.string().trim().required().oneOf(["google", "apple", "facebook"]),

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.signupWithEmailValidation = async (req, res, next) => {

    try {

        await yup.object({

            //userName: yup.string().required().min(3).max(20),
            password: yup.string().trim().required(),
            email: yup.string().required().email(),

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.signinWithEmailValidation = async (req, res, next) => {

    try {

        await yup.object({

            fcmToken: yup.string().trim().required(),
            deviceToken: yup.string().trim().required(),
            deviceType: yup.string().required().oneOf(['ios', 'android', 'web']),
            password: yup.string().trim().required(),
            email: yup.string().trim().required().email(),

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.forgotPasswordValidation = async (req, res, next) => {

    try {

        await yup.object({

            email: yup.string().trim().required().email(),

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.verifyForgotPasswordOtpValidation = async (req, res, next) => {

    try {

        await yup.object({

            otp: yup.number().required(),
            email: yup.string().trim().required().email(),

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.resetPasswordValidation = async (req, res, next) => {

    try {

        await yup.object({

            password: yup.string().trim().required(),
            token: yup.string().trim().required()

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.changePasswordValidation = async (req, res, next) => {

    try {

        await yup.object({

            // newPassword: yup.string().trim().required().matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, messagesEnglish.invalidPasswordValidation),
            oldPassword: yup.string().trim().required(),
            newPassword: yup.string().trim().required()


        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.addCoinsValidation = async (req, res, next) => {

    try {

        await yup.object({

            userId: yup.string().matches(/^[0-9a-zA-Z]{24}$/, 'Required valid object Id').required(),
            coins: yup.number().required()

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.verifyPhoneOtpValidation = async (req, res, next) => {

    try {

        await yup.object({ otp: yup.number().required() }).validate(req.body);
        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.createProfileValidation = async (req, res, next) => {

    try {

        await yup.object({

            dob: yup.date().required(),
            country: yup.string().trim().required().min(3).max(30),
            name: yup.string().trim().required().min(3).max(20),

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.friendListValidation = async (req, res, next) => {

    try {

        await yup.object({

            type: yup.string().trim().required().oneOf(["sent", "received", "friend"])

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.updateRewardsValidation = async (req, res, next) => {

    try {

        await yup.object({

            xp: yup.number().required(),
            diamonds: yup.number().required(),
            coins: yup.number().required()

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.adminLoginValidation = async (req, res, next) => {

    try {

        await yup.object({

            deviceToken: yup.string().trim().required(),
            deviceType: yup.string().required().oneOf(['ios', 'android', 'web']),
            password: yup.string().trim().required(),
            email: yup.string().trim().required().email(),

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.resetPasswordLinkCheckValidation = async (req, res, next) => {

    try {

        await yup.object({

            token: yup.string().trim().required()

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
};

module.exports.createAnnouncementValidation = async (req, res, next) => {

    try {

        await yup.object({

            description: yup.string().required().min(3).max(500),
            title: yup.string().required().min(3).max(30)

        }).validate(req.body);

        next();
    }
    catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}

module.exports.createRoom = async (req, res, next) => {
    try {

        await yup.object({
            numberOfRounds: yup.number().required(),
            timeForEveryMove: yup.number().required()
        }).validate(req.body);
        next();
    } catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}

module.exports.sendInvitation = async (req, res, next) => {
    try {
        await yup.object({
            roomId: yup.string().required(),
            playerIds: yup.array().required()
        }).validate(req.body);
        next();
    } catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}

module.exports.sendMessageForPlayer = async (req, res, next) => {
    try {
        await yup.object({
            matchId: yup.string().matches(/^[0-9a-zA-Z]{24}$/, 'Required valid object Id').required(),
            message: yup.string().required()
        }).validate(req.body);
        next();
    } catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}

module.exports.sendActionForMatchPlayer = async (req, res, next) => {
    try {
        await yup.object({
            matchId: yup.string().matches(/^[0-9a-zA-Z]{24}$/, 'Required valid object Id').required(),
            message: yup.string().required(),
            type: yup.string().oneOf(["action", "gift", "audio"]).required(),
            userId: yup.string().matches(/^[0-9a-zA-Z]{24}$/, 'Required valid object Id').required(),

        }).validate(req.body);
        next();
    } catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}

module.exports.scoreSheet = async (req, res, next) => {
    try {
        await yup.object({
            matchId: yup.string().matches(/^[0-9a-zA-Z]{24}$/, 'Required valid object Id').required(),

        }).validate(req.body);
        next();
    } catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}

module.exports.purchaseShopItem = async (req, res, next) => {
    try {
        await yup.object({
            itemType: yup.string().required(),
            name: yup.string().required(),
            coins: yup.number().required(),

        }).validate(req.body);
        next();
    } catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}


module.exports.purchaseCoins = async (req, res, next) => {
    try {
        await yup.object({
            coins: yup.string().required(),
            productId: yup.string().required(),
            reciept: yup.string().required(),

        }).validate(req.body);
        next();
    } catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}

module.exports.purchaseSubscription = async (req, res, next) => {
    try {
        await yup.object({
            productId: yup.string().required(),
            reciept: yup.string().required(),
        }).validate(req.body);
        next();
    } catch (err) { return res.status(responseStatus.badRequest).send(utils.createErrorResponse(err.message)); }
}