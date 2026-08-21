
const mongoose = require("mongoose");
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

// Socket handshake se token nikalo — teen jagah dekhni padti hai:
//   - `auth`    -> Socket.IO v4 ka sahi tareeka, browser me yahi bharosemand hai
//   - `query`   -> fallback (websocket-only transport pe bhi pahunch jaata hai)
//   - `headers` -> native C# client / server-to-server. Browser me custom header
//                  preflight maangta hai, isliye akela ispe depend nahi kar sakte.
// WebGL client teeno bhejta hai, isliye jo pehle mile wahi le lo.
const getHandshakeToken = (socket) => {
    const { auth = {}, query = {}, headers = {} } = socket.handshake || {};
    return auth.authorization || auth.token || query.authorization || query.token || headers['authorization'] || null;
}

const getHandshakeLanguage = (socket) => {
    const { auth = {}, query = {}, headers = {} } = socket.handshake || {};
    return auth.language || query.language || headers['language'] || null;
}

// `createErrorResponse` OBJECT lautata hai, aur `new Error(obj)` ka message
// "[object Object]" ban jaata hai -> client ke connect_error me kuch samajh nahi aata.
// Isliye string nikaal ke Error banao, aur `reason` alag se attach karo taaki
// client ko pata chale ki auth exactly kahan atka.
const socketAuthError = (messageKey, language, reason) => {
    // NOTE: `createErrorResponse(message, success)` ka doosra param `success` hai, language NAHI.
    // Purana code yahan `language` pass karta tha -> response me `success: null` aata tha.
    const body = utils.createErrorResponse(messageKey);
    const error = new Error(body?.message || "Unauthorized");
    error.data = { ...body, reason };
    return error;
}

module.exports.socketUserAuthenticationOld= async (socket, next) => {

    try {
        console.log(":::tokoooooooooooooo::")


        const token = getHandshakeToken(socket);
        const language = getHandshakeLanguage(socket);

        console.log(":::;tike::", token, typeof token, socket.handshake.headers)

        if (!token) return next(socketAuthError("loginSessionExpired", language, "NO_TOKEN"));

        // Token abhi raw user `_id` hai. Galat format aaya to Mongo `CastError` phenkta hai
        // jo catch me jaake generic error banta — client ko "invalid token" hi dikhna chahiye.
        if (!mongoose.Types.ObjectId.isValid(token)) return next(socketAuthError("loginSessionExpired", language, "BAD_TOKEN_FORMAT"));

        const user = await userSchema.model.findOne({ _id: token }).lean();
        //const user = await userSchema.model.findOne({}).lean();


        console.log(":::::::::::::::::;;biiii", user)

        if (!user) return next(socketAuthError("loginSessionExpired", language, "USER_NOT_FOUND"));


        await userSchema.model.updateOne({ _id: user._id }, { socketId: socket.id,sessionActive:true });
        socket.user = { ...user, socketId: socket.id, language };

        next();

    } catch (error) {
        console.log('error=>>>', error)
        return next(error);
    };
}

module.exports.socketUserAuthentication = async (socket, next) => {

    try {

        const token = getHandshakeToken(socket);
        const language = getHandshakeLanguage(socket);

        console.log(":::;auth>>>>>>>>>>++++++Toke++++++:>>>>>>>>>>>>>>>>>>>>>>>>>>:", typeof token)

        if (!token) return next(socketAuthError("loginSessionExpired", language, "NO_TOKEN"));

        // launch pe jo sessionToken diya tha wahi wapas aata hai
        const tokenDetails = utils.verifyToken(token);
        if (!tokenDetails) return next(socketAuthError("loginSessionExpired", language, "INVALID_JWT"));

        const { _id, userId } = tokenDetails;
        const user = await userSchema.model.findOneAndUpdate({ _id, userId, sessionClosed: false }, { socketId: socket.id, disconnect: null }, { new: true }).lean();
        if (!user) return next(socketAuthError("loginSessionExpired", language, "SESSION_NOT_FOUND_OR_CLOSED"));

        // Banda wapas aa gaya -> disconnect stamp hata do.
        //await userSchema.model.updateOne({ _id: user._id }, { socketId: socket.id, disconnect: null });
        socket.user = { ...user, socketId: socket.id, language };

        next();

    } catch (error) {
        console.log('error=>>>', error)
        return next(error);
    };
}