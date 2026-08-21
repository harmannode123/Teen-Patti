// Cross-process turn auto-pack timer — BullMQ (Redis-backed delayed jobs).
//
// Problem: 30s turn timer pehle `global.turnTimers` (ek hi process ki memory) me tha.
// Cluster (PM2 multi-process) me:
//   - timer ek process pe set hota, lekin cancel call doosre process pe aata -> cancel MISS.
//   - process crash/restart -> us process ke saare pending timers gayab.
//
// Solution: BullMQ ek delayed job ("30s baad auto-pack") Redis me daalta hai. Koi bhi
// worker (kisi bhi process me) job uthaa sakta hai. Crash pe job recover + retry milta hai.
//   - schedule : turnQueue.add(..., { delay: 30s })  -> job id ko Redis hash me track karte hain
//   - cancel   : us match ke tracked job ko remove
//   - worker   : job fire hone par us match ke current turn player ko auto-pack
//
// Note: placeBet khud lock leta aur turn validate karta hai ({ turn: userId }). Agar player
// already khel chuka to turn aage badh gaya -> auto-pack no-op. To late/double fire bhi SAFE.

const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// BullMQ blocking commands use karta hai -> dedicated connection chahiye jisme
// maxRetriesPerRequest: null ho (app ki singleton connection reuse nahi kar sakte).
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
connection.on("error", (err) => console.log("bullmq redis error =>", err.message));

const QUEUE_NAME = "turn-timer";
const TURN_MS = 30000; // 30s turn (client timer ke barabar)

// matchId -> current BullMQ jobId (cancel/replace ke liye track karna zaroori hai,
// kyunki hum fixed jobId nahi use karte — warna active job ke saath collision hota).
const ACTIVE_JOBS = "turn:autopack:jobs";

const turnQueue = new Queue(QUEUE_NAME, { connection });

// 30s baad ka auto-pack schedule karo. Same match ka purana timer pehle hata dete hain
// (ek match = ek hi active turn timer).
const scheduleAutoPack = async (matchId, playerTurnId, delayMs = TURN_MS) => {
    if (!matchId || !playerTurnId) return;
    const mid = String(matchId);

    // Purana job (agar ho) hata do.
    await cancelAutoPack(mid);

    const job = await turnQueue.add(
        "autopack",
        { matchId: mid, playerTurnId: String(playerTurnId) },
        {
            delay: delayMs,
            attempts: 3,                              // fail ho to retry (reliability)
            backoff: { type: "fixed", delay: 1000 },
            removeOnComplete: true,                   // Redis saaf rakho
            removeOnFail: true,
        }
    );

    // Naye job ka id track karo taaki baad me cancel kar sakein.
    await connection.hset(ACTIVE_JOBS, mid, job.id);
};

// ---- General match-FLOW delayed jobs (BullMQ) ----------------------------
// Game ko aage badhane wale delays (cards deal 5s, betTurn 2s/20s, next round 5s)
// pehle in-process setTimeout me the -> process restart/reload pe gayab ho jaate the
// (match freeze). Ab ye BullMQ delayed jobs hain -> restart pe bhi koi worker uthaake
// match aage badha deta hai. Fire-and-forget (cancel ki zaroorat nahi); handler khud
// validate karta hai (match end/turn check), to thoda late/double fire bhi safe.
//   type    = "betTurn" | "dealCards" | "startNext"
//   payload = { matchId, playerTurnId? }
const scheduleFlow = async (type, payload, delayMs) => {
    if (!type) return;
    await turnQueue.add(type, payload || {}, {
        delay: delayMs,
        attempts: 1,            // ek hi baar (double betTurn emit se bachne ke liye)
        removeOnComplete: true,
        removeOnFail: true,
    });
};

// Us match ke chal rahe auto-pack me kitna time BACHA hai (ms). Job hi authority hai —
// wahi banda pack karega, to client ko dikhne wala har countdown isi se nikalna chahiye.
//
// `match.updatedAt` se calculate karna GALAT hai: seenCard bhi match doc update karta hai
// (turn ke beech me updatedAt reset ho jaata), aur betTurn emit turn-change ke ~2s BAAD
// hota hai -> dono taraf se value bahak jaati.
//
// Job na mile (timer hi nahi laga / already fire ho gaya) -> null. Caller decide kare.
const getAutoPackRemainingMs = async (matchId) => {
    if (!matchId) return null;
    try {
        const jid = await connection.hget(ACTIVE_JOBS, String(matchId));
        if (!jid) return null;
        const job = await turnQueue.getJob(jid);
        if (!job) return null;
        // BullMQ: timestamp = job bana tab ka epoch, delay = kitne ms baad chalega.
        const fireAt = Number(job.timestamp || 0) + Number(job.delay || 0);
        const left = fireAt - Date.now();
        return left > 0 ? left : 0;
    } catch (e) {
        return null;
    }
};

// Player ne time pe action le liya (ya match khatam) -> us match ka timer cancel.
const cancelAutoPack = async (matchId) => {
    if (!matchId) return;
    const mid = String(matchId);
    try {
        const jid = await connection.hget(ACTIVE_JOBS, mid);
        if (jid) {
            const job = await turnQueue.getJob(jid);
            // active/locked job remove pe throw kar sakta hai -> catch me ignore
            // (removeOnComplete usse waise bhi saaf kar dega).
            if (job) await job.remove();
        }
    } catch (e) {
        /* job already processing / removed -> koi baat nahi */
    }
    await connection.hdel(ACTIVE_JOBS, mid);
};

let worker = null;

// Har process boot par EK baar call karo. Job fire hone par auto-pack chalata hai.
const startTurnWorker = () => {
    if (worker) return worker; // dobara start na ho

    worker = new Worker(
        QUEUE_NAME,
        async (job) => {
            const io = global.io;
            if (!io) return;

            // Lazy require -> circular dependency (gameplay <-> turnTimer) se bachne ke liye.
            const gameplay = require("../controller/v1/gameplay.controller");
            const d = job.data || {};

            // Job ke naam (type) ke hisaab se dispatch.
            switch (job.name) {
                case "autopack":
                    // 30s tak action nahi -> current turn player ko auto-pack.
                    // placeBet khud lock + turn validate karta hai (already khela to no-op) -> safe.
                    await gameplay.placeBet(io, d.playerTurnId, null, { isPacked: true, amount: 0 });
                    break;
                case "betTurn":
                    // Next player ka turn emit + 30s auto-pack schedule.
                    await gameplay._flowBetTurn(io, d.matchId, d.playerTurnId);
                    break;
                case "dealCards":
                    // Match start ke baad cards emit + pehla betTurn schedule.
                    await gameplay._flowDealCards(io, d.matchId);
                    break;
                case "firstJoker":
                    // ZHANDU: pehla betTurn se 2s pehle J1 jokerOpened emit.
                    await gameplay._flowFirstJoker(io, d.matchId);
                    break;
                case "startNext":
                    // Round khatam -> agla match shuru.
                    await gameplay._flowStartNext(io, d.matchId);
                    break;
                case "closeSession":
                    // Disconnect ke 5 min baad — banda wapas nahi aaya to session close.
                    await gameplay._flowCloseSession(d.userId);
                    break;
            }
        },
        { connection: connection.duplicate(), concurrency: 50 }
    );

    worker.on("error", (err) => console.log("turn-worker error =>", err.message));
    worker.on("failed", (job, err) => console.log("turn-worker job failed =>", job?.id, err?.message));

    console.log("----- Turn auto-pack worker started. -----");
    return worker;
};

module.exports = { scheduleAutoPack, cancelAutoPack, scheduleFlow, startTurnWorker, getAutoPackRemainingMs };
