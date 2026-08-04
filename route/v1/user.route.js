// Dependencies
const express = require("express");
const router = express.Router();
const userController = require("../../controller/v1/user.controller");
const validation = require('../../middleware/validation');

// Game launch (aggregator) — operator apne user ko launch karta hai, hume gameUrl milta hai
router.post("/launch", validation.launchValidation, userController.launch);

module.exports = router;
