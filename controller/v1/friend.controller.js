// dependencies
const friendSchema = require('../../model/friend.model');
const notificationSchema = require('../../model/notification.model');
const utils = require('../../helper/utils');
const { responseStatus, messagesArabic, messagesEnglish } = require('../../helper/appConstant');
const aggregation = require('./aggregation.controller');
const { sendFcmNotification } = require('../../helper/firebase.notification');

// Send friend request
module.exports.sendRequest = async (req, res, next) => {

    try {

        const { id } = req.params;
        if (!utils.parseMongoObjectId(id)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const user = (await aggregation.findUserWithStatus(req.user._id, id))[0];
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        if (user.alreadyFriend) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("alreadyFriend", req.language));
        if (user.friendRequestSent) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("friendRequestAlreadySent", req.language));
        if (user.friendRequestReceived) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("friendRequestAlreadyReceived", req.language));

        await friendSchema.model({ from: req.user._id, to: id }).save();

        // Send fcm notification and create record for notification
        const notificationdData = { from: req.user._id, to: user._id, title: "friend request", type: "sendRequest", description: `${req.user?.name} sent you a request.` };

        await notificationSchema.model(notificationdData).save();
        user.fcmToken && sendFcmNotification(req.language === "ar" ? messagesArabic.friendRequest : messagesEnglish.friendRequest, `${req.user.userName} ${req.language === "ar" ? messagesArabic.sentYouFriendRequest : messagesEnglish.sentYouFriendRequest}`, notificationdData, user.fcmToken)

        io.to(user?.socketId).emit('notificationCount', { notificationCount: user?.notificationCount });
        return res.status(responseStatus.success).json(utils.createSuccessResponse("friendRequestSend", req.language));
    }
    catch (error) { return next(error); }
};

// Accept friend request
module.exports.acceptRequest = async (req, res, next) => {

    try {

        const { id } = req.params;
        if (!utils.parseMongoObjectId(id)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const user = (await aggregation.findUserWithStatus(req.user._id, id))[0];
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        if (!user.friendRequestReceived) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("friendRequestNotFound", req.language));

        await friendSchema.model.updateOne({ _id: user.friendRequestId }, { isAccepted: true });

        // Send fcm notification and create record for notification
        const notificationdData = { from: req.user._id, to: user._id, title: "friend request accepted", type: "acceptRequest", description: `${req.user?.name} accepted your request.` };

        await notificationSchema.model(notificationdData).save();
        user.fcmToken && sendFcmNotification(req.language === "ar" ? messagesArabic.friendRequest : messagesEnglish.friendRequest, `${req.user.userName} ${req.language === "ar" ? messagesArabic.acceptedYourFriendRequest : messagesEnglish.acceptedYourFriendRequest}`, notificationdData, user.fcmToken)
        io.to(user?.socketId).emit('notificationCount', { notificationCount: user?.notificationCount });

        return res.status(responseStatus.success).json(utils.createSuccessResponse("friendRequestAccepted", req.language));
    }
    catch (error) { return next(error); }
};

// Reject friend request
module.exports.rejectRequest = async (req, res, next) => {

    try {

        const { id } = req.params;
        if (!utils.parseMongoObjectId(id)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const user = (await aggregation.findUserWithStatus(req.user._id, id))[0];
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        if (!user.friendRequestReceived) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("friendRequestNotFound", req.language));

        await friendSchema.model.deleteOne({ _id: user.friendRequestId });
        return res.status(responseStatus.success).json(utils.createSuccessResponse("friendRequestRejected", req.language));
    }
    catch (error) { return next(error); }
};

// Cancel friend request
module.exports.cancelRequest = async (req, res, next) => {

    try {

        const { id } = req.params;
        if (!utils.parseMongoObjectId(id)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const user = (await aggregation.findUserWithStatus(req.user._id, id))[0];
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        if (!user.friendRequestSent) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("friendRequestNotFound", req.language));

        await friendSchema.model.deleteOne({ _id: user.friendRequestId });
        return res.status(responseStatus.success).json(utils.createSuccessResponse("friendRequestCancelled", req.language));
    }
    catch (error) { return next(error); }
};

// Unfriend
module.exports.unfriend = async (req, res, next) => {

    try {

        const { id } = req.params;
        if (!utils.parseMongoObjectId(id)) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        const user = (await aggregation.findUserWithStatus(req.user._id, id))[0];
        if (!user) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        if (!user.alreadyFriend) return res.status(responseStatus.badRequest).json(utils.createErrorResponse("userNotFound", req.language));

        await friendSchema.model.deleteOne({ _id: user.friendRequestId });
        return res.status(responseStatus.success).json(utils.createSuccessResponse("friendRemoved", req.language));
    }
    catch (error) { return next(error); }
};

// Sent, receviced and friend list
module.exports.list = async (req, res, next) => {

    try {

        const { type, offset, limit, search } = utils.customBodyParser(req.body);
        let users = []

        if (type === "sent") users = await aggregation.sentFriendRequestList(req.user._id, offset, limit, search);
        if (type === "received") users = await aggregation.receivedFriendRequestList(req.user._id, offset, limit, search);
        if (type === "friend") users = await aggregation.friendList(req.user._id, offset, limit, search);

        return res.status(responseStatus.success).json(utils.createSuccessResponse("usersFetched", req.language, users));
    }
    catch (error) { return next(error); }
};

// Search user
module.exports.searchUser = async (req, res, next) => {

    try {

        const { offset, limit, search } = utils.customBodyParser(req.body);
        const users = await aggregation.searchUser(req.user._id, offset, limit, utils.escapeSpecialCharacter(search));

        return res.status(responseStatus.success).json(utils.createSuccessResponse("usersFetched", req.language, users));
    }
    catch (error) { return next(error); }
};