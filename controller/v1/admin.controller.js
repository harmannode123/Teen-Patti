// dependencies
const adminSchema = require('../../model/admin.model');
const utils = require('../../helper/utils');
const { responseStatus } = require('../../helper/appConstant');

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

