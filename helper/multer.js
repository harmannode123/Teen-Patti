// Dependencies
const multer = require('multer');
const utils = require('../helper/utils');
const { responseStatus } = require('../helper/appConstant');
const path = require('path')

// For user image upload
module.exports.multerForUser = (req, res, next) => {

    return multer({

        storage: multer.diskStorage({

            destination: function (req, file, cb) { cb(null, `public/user`) },
            filename: function (req, file, cb) { cb(null, Date.now() + path.extname(file.originalname)) + file.originalname }
        })

    }).single("image")(req, res, (err) => err ? res.status(responseStatus.badRequest).json(utils.createErrorResponse(err.message)) : next())

}