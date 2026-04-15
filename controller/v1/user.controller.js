// dependencies
const userSchema = require('../../model/user.model');
const roomSchema = require('../../model/room.model');
const utils = require('../../helper/utils');
const { responseStatus, messagesEnglish, purchaseShopType, getUserBadge } = require('../../helper/appConstant');
const { joinRoom } = require('../../controller/v1/gameplay.controller')
const ejs = require('ejs')
const moment = require('moment');
const { sendEmail } = require('../../helper/emailHelper');
const aggregation = require('./aggregation.controller');
const { default: mongoose } = require('mongoose');

const matchSchema = require("../../model/match.model");
const purchaseItemSchema = require("../../model/purchaseItem.model");
const shopSchema = require("../../model/shop.model");
const purchaseCoinSchema = require('../../model/purchasecoin.model')
const friendSchema = require('../../model/friend.model')
const { sendFcmNotification } = require('../../helper/firebase.notification');
const notificationSchema = require('../../model/notification.model');


// Social sign-in
module.exports.socialSignin = async (req, res, next) => {

    try {

        const { socialId, socialType, image, deviceType, deviceToken, fcmToken } = req.body;
        let user = await userSchema.model.findOne({ socialId, socialType }).select('_id').lean();

        if (!user) user = await userSchema.model({ socialId, socialType, image, deviceType, deviceToken, fcmToken }).save();
        if (user.isBlock) return res.status(responseStatus.forbidden).json(utils.createErrorResponse("accountBlockedByAdmin", req.language));

        await userSchema.model.updateOne({ _id: user._id }, { deviceToken, deviceType, image, deviceType, deviceToken, fcmToken });

        return res.status(responseStatus.success).json(utils.createSuccessResponse("loggedIn", req.language, { token: utils.generateToken({ _id: user._id, deviceToken, deviceType, socialId, socialType, password: null }) }));
    }
    catch (error) { return next(error); }
};




const crypto = require('crypto');
const axios = require('axios');


const agentId = "202603271442";
const key = "H6M8szxwUwZbXZxp";
const currency = "USD";

function generateSign({ agentId, orderNo, currency, amount, email, key }) {
    const str = agentId + orderNo + currency + amount + email + key;
    return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
}

module.exports.addPayment = async (req, res, next) => {
    try {
        const { amount, email, productName } = req.body;

        // ✅ Validation
        if (!amount || !email || !productName) {
            return res.status(400).json({
                message: "amount, email, productName are required"
            });
        }

        let orderNo = "ORD" + Date.now()


        const data = {
            agentId,
            orderNo: orderNo,
            currency,
            amount: Number(amount).toFixed(2), // ensure format
            email,
            productName,
            returnUrl: "https://yourwebsite.com/success",
            notifyUrl: " https://waterlocked-zanily-alise.ngrok-free.dev/api/v1/user/notify",
            ip: req.ip?.replace('::ffff:', '') || "127.0.0.1"
        };

        data.sign = generateSign({ ...data, key });

        const url = "https://www.eqjncvb.com/v2.0/in/wallet";

        const response = await axios.post(
            url,
            new URLSearchParams(data).toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );

        const result = response.data;

        console.log("Payment API Response:", result);

        if (result.code !== 200) {
            return res.status(400).json({
                message: result.message || "Payment API failed"
            });
        }

        // ✅ IMPORTANT: send payUrl to frontend
        return res.status(200).json({
            message: "Payment created successfully",
            orderNo,
            payUrl: result?.data?.payUrl
        });

    } catch (error) {

        console.log(":::::::::::::error::::::", error?.message)

        return res.status(500).json({
            message: error.response?.data?.message || error.message
        });
    }
};


module.exports.notify = async (req, res, next) => {
    try {

        console.log("::::::::::::::::notify data::::::", req.body, req.query)

        // ✅ IMPORTANT: send payUrl to frontend
        return res.status(200).json({
            message: "Notify success::::::::::::::::::::::::::::::",
        });

    } catch (error) {

        return res.status(500).json({
            message: error.response?.data?.message || error.message
        });
    }
};

