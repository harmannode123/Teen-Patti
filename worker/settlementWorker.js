

const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

const userSchema = require("../model/user.model");
const gameSessionSchema = require("../model/gameSession.model");
const { acquireLock, releaseLock } = require("../helper/lock.helper");
const { registerWorker, reportRedisError } = require("../helper/redisGuard.helper");

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// BullMQ blocking commands use karta hai -> dedicated connection chahiye jisme
// maxRetriesPerRequest: null ho (app ki singleton connection reuse nahi kar sakte).
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
connection.on("error", (err) => { console.log("settlement redis error =>", err.message); reportRedisError(err); });

const QUEUE_NAME = "settlement";
const SWEEP_MS = 60 * 1000;      // har 10 sec — result callback jaldi pahunchana hai
const SWEEP_SCHEDULER_ID = "settlement-sweep"; // BullMQ job scheduler ki fixed id
const LOCK_KEY = "settlement";
const LOCK_TTL_MS = 60 * 1000;   // sweep atak jaye to bhi taala apne aap khul jaye

const settlementQueue = new Queue(QUEUE_NAME, { connection });

// Ek sweep. Closed sessions dhoondo jinka koi match baaki nahi -> settle karo.
const runSettlementSweep = async () => {

    // maxWait 1ms = koi aur instance sweep kar raha hai to turant nikal jao, wait mat karo.
    const token = await acquireLock(LOCK_KEY, LOCK_TTL_MS, 1);
    if (!token) return;

    try {
        const rows = await userSchema.model.aggregate([
            { $match: { sessionActive:true,sessionClosed: true} },
            {
                $lookup: {
                    from: "matches",
                    let: { uid: "$_id" },
                    pipeline: [
                        // `end: false` — sirf started nahi, waiting match me baitha ho to bhi
                        // settle nahi karna.
                        { $match: { $expr: { $and: [{ $in: ["$$uid", "$players"] }, { $eq: ["$end", false] }] } } },
                        { $limit: 1 },          // ek bhi mil gaya to kaafi, ginti nahi chahiye
                        { $project: { _id: 1 } }
                    ],
                    as: "pendingMatches"
                }
            },
            { $match: { pendingMatches: { $size: 0 } } },
            { $project: { _id: 1, coins: 1, amount: 1,sendCallback:1 } }
        ]);

        if (!rows.length) return;

        // Absolute values likh rahe hain ($inc nahi) -> dobara chale to wahi result.
        // upsert isliye ki archive doc kisi wajah se missing ho to paisa atak na jaye.
        await gameSessionSchema.model.bulkWrite(rows.map((u) => ({
            updateOne: {
                filter: { _id: u._id },
                update: {
                    finalCoins: u.coins || 0,
                    netResult: (u.coins || 0) - (u.amount || 0),
                    settlement: true,
                    startAmount:u?.amount,
                    sendCallback:u?.sendCallback,
                },
                upsert: true,
            }
        })));

        // Snapshot ke BAAD delete — ulta kiya to coins gayab aur settle kabhi nahi hoga.
        await userSchema.model.deleteMany({ _id: { $in: rows.map((u) => u._id) } });

        console.log(`::: settled sessions ::: ${rows.length}`);
    } catch (error) {
        console.log("settlement sweep error =>", error?.message);
    } finally {
        await releaseLock(LOCK_KEY, token);
    }
};

let worker = null;

// Har process boot par EK baar call karo.
const startSettlementWorker = async () => {
    if (worker) return worker; // dobara start na ho

    worker = new Worker(
        QUEUE_NAME,
        async () => { await runSettlementSweep(); },
        { connection: connection.duplicate(), concurrency: 1 }
    );

    worker.on("error", (err) => console.log("settlement-worker error =>", err.message));
    worker.on("failed", (job, err) => console.log("settlement-worker job failed =>", job?.id, err?.message));

    // Redis outage me worker pause / recovery pe auto-resume (redisGuard.helper dekho).
    registerWorker("settlement-worker", worker);

    // Pehle add({ repeat }) use hota tha — BullMQ v5 me wo deprecated hai, v6 me hat jayega
    // (getRepeatableJobs / removeRepeatableByKey bhi). Uski key interval se bani hash thi,
    // isliye Redis me purana schedule (e.g. "7329d3...") pada reh sakta hai. Fixed id ke
    // alawa jo bhi schedule mile hata do, warna purana + naya dono fire karke sweep double hoga.
    // Hata hua schedule worker dobara nahi banata (updateJobScheduler ZSCORE check karta hai).
    const schedulers = await settlementQueue.getJobSchedulers();
    for (const s of schedulers) {
        if (s.key !== SWEEP_SCHEDULER_ID) await settlementQueue.removeJobScheduler(s.key);
    }

    // Fixed id -> saare PM2 instances same schedule ko upsert karte hain, ek hi banti hai.
    // SWEEP_MS badla to isi id pe interval replace ho jaata hai, alag schedule nahi banta.
    await settlementQueue.upsertJobScheduler(SWEEP_SCHEDULER_ID, { every: SWEEP_MS }, {
        name: "sweep",
        opts: { removeOnComplete: true, removeOnFail: true },
    });

    console.log("----- Settlement worker started. -----");
    return worker;
};

module.exports = { startSettlementWorker, runSettlementSweep };
