// Dependencies
const express = require("express");
const router = express.Router();
const adminController = require("../../controller/v1/admin.controller");
const adminGamesController = require("../../controller/v1/adminGames.controller");
const validation = require('../../middleware/validation');
const { adminPanelAuthentication } = require('../../middleware/authentication');

router.post("/sign-in", validation.adminLoginValidation, adminController.login);

// Admin panel -> "3D Games" tab (teenpatti / zhandu / flipper / variation)
router.get("/3d-games/dashboard", adminPanelAuthentication, validation.adminGamesValidation, adminGamesController.dashboard);
router.get("/3d-games/gameplay", adminPanelAuthentication, validation.adminGamesValidation, adminGamesController.gameplay);
router.get("/3d-games/users", adminPanelAuthentication, validation.adminGamesValidation, adminGamesController.users);
router.get("/3d-games/live", adminPanelAuthentication, validation.adminGamesValidation, adminGamesController.live);

module.exports = router;