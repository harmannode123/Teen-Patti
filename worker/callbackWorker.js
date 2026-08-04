

const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const axios = require("axios");
const moment = require("moment");

const gameSessionSchema = require("../model/gameSession.model");
const { acquireLock, releaseLock } = require("../helper/lock.helper");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// BullMQ blocking commands use karta hai -> dedicated connection chahiye jisme
// maxRetriesPerRequest: null ho (app ki singleton connection reuse nahi kar sakte).
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
connection.on("error", (err) => console.log("callback redis error =>", err.message));

const QUEUE_NAME = "callback";
const SWEEP_MS = 60 * 1000;          // sweep har 1 min
const RETRY_GAP_MS = 5 * 60 * 1000;  // par ek doc ko 5 min me ek hi baar try karenge
// Operator usi machine pe chal raha hai -> ye loopback call hai, microseconds ki baat.
// 3s se zyada lag raha hai matlab operator hang hai, aur wait karne ka faayda nahi.
const REQUEST_TIMEOUT_MS = 3000;
const BATCH = 100;                   // ek sweep me max itne sessions
const MAX_ATTEMPTS = 5;              // 5 try (≈20 min) ke baad band — uske aage manual
const LOCK_KEY = "callback";

const LOCK_TTL_MS = 20 * 60 * 1000;  // 20 min

const callbackQueue = new Queue(QUEUE_NAME, { connection });

const runCallbackSweep = async () => {

    // maxWait 1ms = koi aur instance sweep kar raha hai to turant nikal jao, wait mat karo.
    const token = await acquireLock(LOCK_KEY, LOCK_TTL_MS, 1);
    if (!token) return;

    try {
        const cutoff = moment.utc().subtract(RETRY_GAP_MS, "milliseconds").toDate();

        const rows = await gameSessionSchema.model.find({
            settlement: true,
            sendCallback: false,
            callbackAttempts: { $lt: MAX_ATTEMPTS },
            $or: [{ lastCallbackAt: null }, { lastCallbackAt: { $lte: cutoff } }],
        }).limit(BATCH).lean();

        if (!rows.length) return;

        let sent = 0;

        // Sequential jaan bujh ke — operator ke server pe ek saath 100 request nahi maarni.
        for (const session of rows) {

            const payload = {
                sessionId: String(session._id),
                userId: session.userId,
                initialAmount: session.startAmount || 0,
                finalAmount: session.finalCoins || 0,
                netResult: session.netResult || 0,
            };

            let success = false;
            let operatorResponse = null;

            try {
                const response = await axios.post(session.callbackUrl, payload, { timeout: REQUEST_TIMEOUT_MS });
                operatorResponse = response.data;
                success =response.data?.success === true && response.data?.message === "success";
            } catch (error) {
                operatorResponse = { error: error?.message };
            }

            await gameSessionSchema.model.updateOne({ _id: session._id }, {
                ...(success ? { sendCallback: true } : {}),
                lastCallbackAt: moment.utc().toDate(),
                operatorResponse,
                $inc: { callbackAttempts: 1 },
            });

            if (success) sent++;
        }

        console.log(`::: callback sweep ::: tried ${rows.length}, success ${sent}`);
    } catch (error) {
        console.log("callback sweep error =>", error?.message);
    } finally {
        await releaseLock(LOCK_KEY, token);
    }
};

let worker = null;

// Har process boot par EK baar call karo.
const startCallbackWorker = async () => {
    if (worker) return worker; // dobara start na ho

    worker = new Worker(
        QUEUE_NAME,
        async () => { await runCallbackSweep(); },
        { connection: connection.duplicate(), concurrency: 1 }
    );

    worker.on("error", (err) => console.log("callback-worker error =>", err.message));
    worker.on("failed", (job, err) => console.log("callback-worker job failed =>", job?.id, err?.message));

    // Repeatable job. Saare instances yahi add karte hain par Redis repeat key se dedupe
    // ho jaata hai -> ek hi schedule banti hai.
    await callbackQueue.add("sweep", {}, {
        repeat: { every: SWEEP_MS },
        removeOnComplete: true,
        removeOnFail: true,
    });

    console.log("----- Callback worker started. -----");
    return worker;
};

module.exports = { startCallbackWorker, runCallbackSweep };
