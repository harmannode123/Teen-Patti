
const { responseStatus } = require("../helper/appConstant");
const utils = require("../helper/utils");
const userSchema = require("../model/user.model");
const adminSchema = require("../model/admin.model");

module.exports.userAuthentication = async (req, res, next) => {

    try {

        const token = req.headers["authorization"];
        if (!token || !token.startsWith('Bearer')) return res.status(responseStatus.unAuthorized).json(utils.createErrorResponse("loginSessionExpired", req.language));

        const tokenDetails = utils.verifyToken(token.split(" ")[1]);
        if (!tokenDetails) return res.status(responseStatus.unAuthorized).json(utils.createErrorResponse("loginSessionExpired", req.language));

        const { _id, deviceToken, deviceType, socialType, socialId } = tokenDetails;
        const user = await userSchema.model.findOne({ _id, deviceToken, deviceType, socialType, socialId }).lean();

        if (!user) return res.status(responseStatus.unAuthorized).json(utils.createErrorResponse("loginSessionExpired", req.language));

        req.user = user;
        next();
    }
    catch (error) { return next(error) }
}

module.exports.adminAuthentication = async (req, res, next) => {

    try {

        const token = req.headers["authorization"];
        if (!token || !token.startsWith('Bearer')) return res.status(responseStatus.unAuthorized).json(utils.createErrorResponse("loginSessionExpired", req.language));

        const tokenDetails = utils.verifyToken(token.split(" ")[1]);
        if (!tokenDetails) return res.status(responseStatus.unAuthorized).json(utils.createErrorResponse("loginSessionExpired", req.language));

        const { _id, deviceToken, deviceType, password } = tokenDetails;
        const admin = await adminSchema.model.findOne({ _id, deviceToken, deviceType, password }).select("_id password").lean();

        if (!admin) return res.status(responseStatus.unAuthorized).json(utils.createErrorResponse("loginSessionExpired", req.language));

        req.user = admin;
        next();
    }
    catch (error) { return next(error) }
}

// module.exports.socketUserAuthentication = async (socket, next) => {

//     try {

//         const token = socket.handshake.headers['authorization'];
//         const language = socket.handshake.headers['language'];

//         if (!token || !token.startsWith('Bearer')) return next(new Error(utils.createErrorResponse("loginSessionExpired", language)));

//         const tokenDetails = utils.verifyToken(token.split(" ")[1]);
//         if (!tokenDetails) return next(new Error(utils.createErrorResponse("loginSessionExpired", language)));

//         const { _id, deviceToken, deviceType, socialType, socialId } = tokenDetails;
//         const user = await userSchema.model.findOne({ _id, deviceToken, deviceType, socialType, socialId }).lean();

//         if (!user) return next(new Error(utils.createErrorResponse("loginSessionExpired", language)));

//         // if (user.socketId) {
//         //     console.log('inside if')
//         //     let my_socket = global.io.sockets.sockets[user.socketId]
//         //     if (my_socket) my_socket.disconnect()
//         // }



//         await userSchema.model.updateOne({ _id: user._id }, { socketId: socket.id });
//         socket.user = { ...user, socketId: socket.id, language };

//         next();

//     } catch (error) {
//         console.log('error=>>>', error)
//         return next(error);
//     };
// }

module.exports.socketUserAuthentication = async (socket, next) => {

    try {

        const token = socket.handshake.headers['authorization'];
        const language = socket.handshake.headers['language'];

        console.log(":::;tike::", token, typeof token, socket.handshake.headers)

        if (!token) return next(new Error(utils.createErrorResponse("loginSessionExpired", language)));

        const user = await userSchema.model.findOne({ _id: token }).lean();

        if (!user) return next(new Error(utils.createErrorResponse("loginSessionExpired", language)));


        await userSchema.model.updateOne({ _id: user._id }, { socketId: socket.id });
        socket.user = { ...user, socketId: socket.id, language };

        next();

    } catch (error) {
        console.log('error=>>>', error)
        return next(error);
    };
}