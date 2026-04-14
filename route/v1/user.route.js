// Dependencies
const express = require("express");
const { userAuthentication } = require("../../middleware/authentication");
const router = express.Router();
const userController = require("../../controller/v1/user.controller");
const validation = require('../../middleware/validation');
const { multerForUser } = require("../../helper/multer");

router.post("/social-sign-in", validation.socialSigninValidation, userController.socialSignin);


router.post("/add-payment", userController.addPayment);

router.post("/notify", userController.notify);





module.exports = router;