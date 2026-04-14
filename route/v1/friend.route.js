// Dependencies
const express = require("express");
const { userAuthentication } = require("../../middleware/authentication");
const router = express.Router();
const friendController = require("../../controller/v1/friend.controller");
const validation = require('../../middleware/validation');

router.get("/send-request/:id", userAuthentication, friendController.sendRequest);

router.get("/accept-request/:id", userAuthentication, friendController.acceptRequest);

router.get("/reject-request/:id", userAuthentication, friendController.rejectRequest);

router.get("/cancel-request/:id", userAuthentication, friendController.cancelRequest);

router.get("/unfriend/:id", userAuthentication, friendController.unfriend);

router.post("/list", userAuthentication, validation.friendListValidation, friendController.list);

router.post("/search-user", userAuthentication, friendController.searchUser);

module.exports = router;