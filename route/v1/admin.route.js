// Dependencies
const express = require("express");
const { adminAuthentication } = require("../../middleware/authentication");
const router = express.Router();
const adminController = require("../../controller/v1/admin.controller");
const validation = require('../../middleware/validation');
const { multerForUser } = require("../../helper/multer");

router.post("/sign-in", validation.adminLoginValidation, adminController.login);

router.post("/forgot-password", validation.forgotPasswordValidation, adminController.forgotPassword);

router.post("/reset-password-link-check", validation.resetPasswordLinkCheckValidation, adminController.resetPasswordLinkCheck);

router.post("/reset-password", validation.resetPasswordValidation, adminController.resetPassword);

router.post("/change-password", adminAuthentication, validation.changePasswordValidation, adminController.changePassword);

router.get("/logout", adminAuthentication, adminController.logout);

router.post("/user-list", adminAuthentication, adminController.usersList);

router.get("/block-user/:id", adminAuthentication, adminController.blockUser);

router.get("/user-details/:id", adminAuthentication, adminController.userDetails);

router.post("/edit-user", adminAuthentication, multerForUser, adminController.editUser);

router.post("/create-announcement", adminAuthentication, validation.createAnnouncementValidation, adminController.createAnnouncement);

router.post("/announcement-list", adminAuthentication, adminController.announcementList);

router.get("/dashboard", adminAuthentication, adminController.dashboard);

router.put("/add-coins", adminAuthentication, validation.addCoinsValidation, adminController.addCoins);

module.exports = router;