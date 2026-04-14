// // Dependencies and modules
require('dotenv/config');
require('./helper/firebase.config');

const mongoose = require('mongoose')
const express = require('express');
const cors = require('cors');
const logger = require('morgan');
const http = require('http');
const utils = require('./helper/utils');
const swaggerUI = require('swagger-ui-express');
const swaggerFile = require('./swagger_output.json');
const mongooseHelper = require('./helper/mongoose.helper');

const mongoUrl = process.env.MONGO_CONNECT_URL;
const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const v1Routes = require('./route/v1/index.route');
const { socketController } = require('./controller/v1/socket.controller');
const io = require('socket.io')(server);
global.io = io
// Database connection
mongoose.connect(mongoUrl)
    .then(() => {

        try {

            // pre-execution functions
            utils.createPublicFolder();
            mongooseHelper.createDefaultAdmin()
            mongooseHelper.createShopItem();

            // language select
            app.use(utils.languageSelector);

            // Socket handler 
            socketController(io);

            // App middlewares
            app.set("view engine", 'ejs');
            app.set('views', "views");
            app.use(cors());
            app.use(logger('dev'));
            app.use(express.json({ limit: '50mb' }));
            app.use(express.urlencoded({ extended: false }));
            app.use('/public', express.static('public'));
            app.use('/api/v1', v1Routes);
            app.use("/swagger", swaggerUI.serve, swaggerUI.setup(swaggerFile));

            // Error handling
            app.use((req, res) => res.status(404).send("Estimation kingdom server is running."));
            app.use((err, req, res, next) => res.status(400).json({ success: false, message: err.message }));

            // Server listening
            server.listen(port, (err) => {

                if (err) {

                    console.log("Server not connected. =>", err.name, ":::", err.message);
                    process.exit()  // Exit the project if server is not connected
                }

                console.log(`----- Server listening on ${port}. -----`);
                console.log(`----- Database successfully connected to ${mongoUrl}. -----`);
            });
        }
        catch (err) { console.log("Internal server error. => ", err.name, ":::", err.message); };
    })

    .catch((err) => {

        console.log("Database not connected. =>", err.name, ":::", err.message);
        process.exit();  // Exit the project if database is not connected
    });
