// dependencies
const adminSchema = require('../../model/admin.model');
const userSchema = require('../../model/user.model');
const utils = require('../../helper/utils');
const { responseStatus, messagesEnglish, socketEmit } = require('../../helper/appConstant');
const ejs = require('ejs')
const moment = require('moment');
const { sendEmail } = require('../../helper/emailHelper');
const aggregation = require('./aggregation.controller');
const notificationSchema = require('../../model/notification.model');

// Login
module.exports.login = async (req, res, next) => {

    try {

        const { email, password, deviceType, deviceToken } = req.body;
        const admin = await adminSchema.model.findOne({ email }).select("_id password").lean();

        if (!admin || !await utils.comparePassword(admin.password, password)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("invalidCredentials", req.language));

        await adminSchema.model.updateOne({ _id: admin._id }, { deviceType, deviceToken });
        return res.status(responseStatus.success).json(utils.createSuccessResponse("loggedIn", req.language, { token: utils.generateToken({ _id: admin._id, password: admin.password, deviceType, deviceToken }) }));
    }
    catch (error) { return next(error); }
};

// Forgot password
module.exports.forgotPassword = async (req, res, next) => {

    try {
        const { email } = req.body;
        const user = await adminSchema.model.findOne({ email }).select("_id").lean();
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("emailNotRegisteredWithUs", req.language));

        const forgotPasswordToken = utils.generateToken({ _id: user._id }, { expiresIn: "10m" });
        await adminSchema.model.updateOne({ _id: user._id }, { forgotPasswordToken });

        ejs.renderFile('views/forgotPasswordForAdmin.ejs', { appName: messagesEnglish.appName, year: moment().format("YYYY"), url: `${process.env.CLIENT_URL}/resetPassword?token=${forgotPasswordToken}` }, (err, data) => !err && sendEmail(email, messagesEnglish.resetPassword, data));
        return res.status(responseStatus.success).json(utils.createSuccessResponse("resetPasswordLinkSent", req.language));
    }
    catch (error) { return next(error); }
};

// Reset password link check
module.exports.resetPasswordLinkCheck = async (req, res, next) => {

    try {

        const { token } = req.body;

        const tokenDetails = utils.verifyToken(token);
        if (!tokenDetails) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("tokenExpired", req.language));

        const user = await adminSchema.model.findOne({ forgotPasswordToken: token }).select("_id").lean();
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("tokenExpired", req.language));

        return res.status(responseStatus.success).json(utils.createSuccessResponse("linkFetched", req.language));
    }
    catch (error) { return next(error); }
};

// Reset password
module.exports.resetPassword = async (req, res, next) => {

    try {

        const { token, password } = req.body;

        const tokenDetails = utils.verifyToken(token);
        if (!tokenDetails) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("tokenExpired", req.language));

        const user = await adminSchema.model.findOne({ forgotPasswordToken: token }).select("_id").lean();
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("tokenExpired", req.language));

        await adminSchema.model.updateOne({ _id: user._id }, { password: await utils.hashPassword(password), forgotPasswordToken: null });
        return res.status(responseStatus.success).json(utils.createSuccessResponse("passwordUpdated", req.language));
    }
    catch (error) { return next(error); }
};

// Change password
module.exports.changePassword = async (req, res, next) => {

    try {

        const { oldPassword, newPassword } = req.body;

        if (!await utils.comparePassword(req.user.password, oldPassword)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("invalidOldPassword", req.language));
        if (await utils.comparePassword(req.user.password, newPassword)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("oldPasswordCannotBeSameAsNewPassword", req.language));

        await adminSchema.model.updateOne({ _id: req.user._id }, { password: await utils.hashPassword(newPassword) });
        return res.status(responseStatus.success).json(utils.createSuccessResponse("passwordUpdated", req.language));
    }
    catch (error) { return next(error); }
};

// Logout
module.exports.logout = async (req, res, next) => {

    try {

        await adminSchema.model.updateOne({ _id: req.user._id }, { deviceToken: null, deviceType: null, fcmToken: null, socketId: null });
        return res.status(responseStatus.success).json(utils.createSuccessResponse("loggedOut", req.language));
    }
    catch (error) { return next(error); }
};

// Users list
module.exports.usersList = async (req, res, next) => {

    try {

        const { offset, limit, sort, order, search } = utils.customBodyParser(req.body);

        const users = await aggregation.usersListForAdmin(offset, limit, sort, order, search);
        const totalCount = users[0]?.totalCount?.count;

        return res.status(responseStatus.success).json(utils.createSuccessResponse("usersFetched", req.language, { list: users[0]?.data || [], pagination: utils.paginationData(totalCount, limit, offset) }));
    }
    catch (error) { return next(error); }
};

// Block user
module.exports.blockUser = async (req, res, next) => {

    try {

        const { id } = req.params;
        if (!utils.isMongoObjectId(id)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const user = await userSchema.model.findOne({ _id: id }).select("_id isBlock").lean();
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        await userSchema.model.updateOne({ _id: id }, { isBlock: !user.isBlock });
        return res.status(responseStatus.success).json(utils.createSuccessResponse(user.isBlock ? "userUnblocked" : "userBlocked", req.language));
    }
    catch (error) { return next(error); }
};

// User details
module.exports.userDetails = async (req, res, next) => {

    try {

        const { id } = req.params;
        if (!utils.isMongoObjectId(id)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const user = (await aggregation.userDetailsForAdmin(id))[0];
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        return res.status(responseStatus.success).json(utils.createSuccessResponse("usersFetched", req.language, user));
    }
    catch (error) { return next(error); }
};

// Edit user
module.exports.editUser = async (req, res, next) => {

    try {

        const { userId, userName, name, dob, country } = req.body;
        if (!utils.isMongoObjectId(userId)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const user = await userSchema.model.findOne({ _id: userId }).select("_id userName name dob country").lean();
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const updateObject = {

            userName: userName || user['userName'],
            name: name || user['name'],
            dob: dob ? moment.utc(dob) : user['dob'],
            country: country || user['country'],
            image: req.file?.path || user['image']
        }

        await userSchema.model.updateOne({ _id: userId }, updateObject);
        return res.status(responseStatus.success).json(utils.createSuccessResponse("userDetailsUpdated", req.language));
    }
    catch (error) { return next(error); }
};

// Dashboard
module.exports.dashboard = async (req, res, next) => {

    try {

        const dashboardData = (await aggregation.dashboard(req.user._id))[0];
        return res.status(responseStatus.success).json(utils.createSuccessResponse("dashboardFetched", req.language, dashboardData));
    }
    catch (error) { return next(error); }
};

// Create announcement
module.exports.createAnnouncement = async (req, res, next) => {
    try {

        const { title, description } = req.body;

        await notificationSchema.model({ title, description, announcement: true }).save();
        return res.status(responseStatus.success).json(utils.createSuccessResponse("announcementCreated", req.language));
    }
    catch (error) { return next(error); }
};

// Announcement list
module.exports.announcementList = async (req, res, next) => {

    try {

        const { offset, limit, sort, order, search } = utils.customBodyParser(req.body);

        const announcements = await aggregation.announcementListForAdmin(offset, limit, sort, order, search);
        const totalCount = announcements[0]?.totalCount?.count;

        return res.status(responseStatus.success).json(utils.createSuccessResponse("announcementFetched", req.language, { list: announcements[0]?.data || [], pagination: utils.paginationData(totalCount, limit, offset) }));
    }
    catch (error) { return next(error); }
};

//Add coins
module.exports.addCoins = async (req, res) => {
    const { userId, coins } = req.body
    const updatedCoins = await userSchema.model.findOneAndUpdate({ _id: userId }, { $inc: { coins } }, { new: true })
    // req.io.to(updatedCoins?.socketId).emit(socketEmit.coinsUpdate, { coins: updatedCoins?.coins })
    return res.status(responseStatus.success).json(utils.createSuccessResponse("coinsUpdated", req.language))
}
