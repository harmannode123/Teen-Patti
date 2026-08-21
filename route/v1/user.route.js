// Dependencies
const express = require("express");
const router = express.Router();
const userController = require("../../controller/v1/user.controller");
const validation = require('../../middleware/validation');

// Game launch (aggregator) — operator apne user ko launch karta hai, hume gameUrl milta hai
router.post("/launch", validation.launchValidation, userController.launch);

// Game history — operator userId ke saare sessions + unke matches (limit/offset pagination)
router.post("/game-history", validation.gameHistoryValidation, userController.gameHistory);

module.exports = router;
