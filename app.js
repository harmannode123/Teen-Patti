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
const io = require('socket.io')(server, {
    // Allow browser/cross-origin clients to connect.
    // `allowedHeaders` zaroori hai: WebGL client `extraHeaders: { authorization }` bhejta hai,
    // aur custom header pe browser pehle preflight OPTIONS maarta hai. Response me ye header
    // allow na ho to browser poori request BLOCK kar deta hai -> connect_error, server pe
    // koi log bhi nahi aata. Native C# client me ye problem hoti hi nahi (CORS sirf browser ka hai).
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['authorization', 'language', 'Content-Type']
    }
});

// --- Socket.IO Redis Adapter (cluster-ready) -----------------------------
// Problem: bina adapter ke, process-1 ka io.to(room).emit process-2 ke sockets
// tak nahi pahunchta. Multiple Node process (PM2 cluster) me emit toot jaata.
// Fix: Redis pub/sub adapter — sab process Redis ke through emits share karte hain.
// Humne rooms (user:<id>) already use kiye hain, to adapter lagते hi cross-process
// emit khud kaam karega. Single process me bhi yeh safe hai (no-op jaisa).
const { createAdapter } = require('@socket.io/redis-adapter');
const redis = require('./helper/redis.helper');
const pubClient = redis;              // existing singleton connection
const subClient = redis.duplicate();  // adapter ko alag subscribe connection chahiye
io.adapter(createAdapter(pubClient, subClient));

global.io = io
// Database connection
mongoose.connect(mongoUrl)
    .then(() => {

        try {

            // pre-execution functions
            utils.createPublicFolder();
            mongooseHelper.createDefaultAdmin()

            // language select
            app.use(utils.languageSelector);

            // Socket handler
            socketController(io);

            // Turn auto-pack worker (BullMQ) — har process me ek. Cluster me bhi
            // koi bhi process expired turn timer uthaa ke auto-pack chalayega.
            const { startTurnWorker } = require('./helper/turnTimer.helper');
            startTurnWorker();

            // Settlement worker (BullMQ repeatable) — closed sessions ka final hisaab
            // jab unke saare match khatam ho jayein. Cluster me repeat key + Redis lock
            // se ek hi sweep chalti hai.
            const { startSettlementWorker } = require('./worker/settlementWorker');
            startSettlementWorker();

            // Callback worker (BullMQ repeatable) — settle ho chuke sessions ka result
            // operator ko bhejta hai. Operator `success: true` na de to har 5 min retry.
            const { startCallbackWorker } = require('./worker/callbackWorker');
            startCallbackWorker();

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
