// Dependencies
const express = require("express");
const router = express.Router();
const adminController = require("../../controller/v1/admin.controller");
const validation = require('../../middleware/validation');

router.post("/sign-in", validation.adminLoginValidation, adminController.login);

module.exports = router;