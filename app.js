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
const { reportRedisError } = require('./helper/redisGuard.helper');
const pubClient = redis;              // existing singleton connection
const subClient = redis.duplicate();  // adapter ko alag subscribe connection chahiye
// duplicate() par listener inherit NAHI hote — bina iske subClient ki error
// unhandled 'error' event ban ke poora process crash kar deti hai (restart loop).
subClient.on('error', (err) => { console.log('Redis sub error =>', err.message); reportRedisError(err); });
io.adapter(createAdapter(pubClient, subClient));

// Safety net: Redis outage (MISCONF jaisi) me stray promise rejections aati hain.
// Crash/spam mat karo — log karo aur guard ko de do (wo workers pause kar dega).
// 24 Aug incident: yehi rejections unhandled reh ke logs bhar rahi thin.
let lastRejectionLogAt = 0;
process.on('unhandledRejection', (err) => {
    reportRedisError(err);
    const now = Date.now();
    if (now - lastRejectionLogAt > 10000) {   // 10s me max ek log (spam se disk/CPU bachao)
        lastRejectionLogAt = now;
        console.log('unhandledRejection =>', err?.message || err);
    }
});

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
            // .unityweb files disk pe pehle se compressed hain (Decompression Fallback build).
            // Content-Encoding header ke bina Unity loader inhe phone ke JS me decompress
            // karta hai — iOS Safari ki memory limit me itna bada decompress + compile
            // nahi samata, WebContent process kill -> blank iframe. Header lagane se
            // browser native (streaming) decompress karta hai, JS-fallback ka memory
            // spike hi nahi aata.
            //
            // 2026-08-31 se build BROTLI hai (pehle gzip) — file header se detect karte
            // hain, hardcode nahi, taaki dev kal wapas gzip build de to bhi na toote.
            // DHYAN: browser 'br' encoding sirf HTTPS pe accept karta hai (Accept-Encoding
            // me br tabhi bhejta hai). Isliye header tabhi lagao jab client ne br manga
            // ho — warna (http://IP se testing) header mat lagao, loader ka apna JS
            // fallback decompress kar lega (dheema hai par chalta hai; real users
            // https://api2.addaplay.com se aate hain jahan native br milega).
            // Cache: build files immutable hain (naya build = naya content), pehle
            // max-age=0 tha to har open pe 86MB revalidate hota tha.
            const fs = require('fs');
            const unitywebEncoding = (filePath) => {
                try {
                    const fd = fs.openSync(filePath, 'r');
                    const head = Buffer.alloc(2);
                    fs.readSync(fd, head, 0, 2, 0);
                    fs.closeSync(fd);
                    if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
                    return 'br'; // Unity ka doosra hi format brotli hai
                } catch (e) { return null; }
            };
            app.use('/public', express.static('public', {
                setHeaders: (res, filePath) => {
                    if (filePath.endsWith('.unityweb')) {
                        const enc = unitywebEncoding(filePath);
                        const accepts = (res.req.headers['accept-encoding'] || '');
                        if (enc === 'gzip' || (enc === 'br' && /\bbr\b/.test(accepts))) {
                            res.setHeader('Content-Encoding', enc);
                        }
                        // ⚠️ .wasm.unityweb pe Content-Type: application/wasm MAT lagana.
                        // Try kiya tha (2026-08-31, streaming compile ke liye) — iOS
                        // WebKit pe instantiateStreaming br-encoded body ke saath beech
                        // me fail hota hai aur Unity ka emscripten fallback default
                        // "build.wasm" file fetch karta hai (jo hai hi nahi) -> 404 ->
                        // loading 20% pe stuck. Android/desktop Chrome pe theek tha,
                        // iOS pe game khulna hi band ho gayi thi. Isliye octet-stream
                        // hi rehne do — loader ArrayBuffer se instantiate karta hai
                        // (thoda dheema, par har jagah chalta hai).
                        // Encoding request ke hisaab se badalta hai -> Vary zaroori,
                        // warna beech ke cache galat encoding wali copy serve kar sakte hain.
                        res.setHeader('Vary', 'Accept-Encoding');
                        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                    }
                }
            }));
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
