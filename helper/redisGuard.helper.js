// Redis outage circuit-breaker (24 Aug incident ka fix).
//
// Problem: disk full hui -> Redis ne RDB save fail hone par saare WRITES reject kar
// diye (MISCONF). BullMQ workers har failed operation ke baad TURANT dobara try
// karte hain -> tight retry loop -> CPU 120% (jabki koi user khel bhi nahi raha tha).
//
// Solution (circuit breaker):
//   - Pehli "Redis outage" wali error par saare registered workers PAUSE kar do
//     (pause local hai, Redis ki zaroorat nahi) -> retry storm band, CPU normal.
//   - Har PROBE_MS par ek chhota WRITE probe maaro. WRITE isliye zaroori hai:
//     MISCONF me Redis connected rehta hai aur PING/reads pass ho jaate hain,
//     sirf writes fail hote hain. PING se probe karte to jhootha "recovered" milta.
//   - Probe pass -> workers RESUME. BullMQ ke jobs Redis me hi pade rehte hain,
//     isliye resume par kaam wahin se aage badhta hai — kuch schedule dobara
//     karna nahi padta.
//
// Note: Redis ke crash me agar data uda (delayed jobs gayab) to chal raha match
// freeze ho sakta hai — wo accepted hai (match off kar denge), recovery yahan
// deliberately nahi banayi.

const redis = require("./redis.helper");

const PROBE_MS = 5000;          // outage me har 5s ek write probe
const LOG_EVERY_MS = 30000;     // outage ke dauran har 30s me ek hi status log (spam nahi)

// Ye errors "Redis outage" gini jaati hain -> breaker trip hota hai.
// MISCONF/READONLY/LOADING = connected but unusable; baaki = connection hi nahi.
const OUTAGE_RE = /MISCONF|READONLY|LOADING|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|Connection is closed|max number of clients/i;

const workers = new Map();      // name -> BullMQ Worker
let tripped = false;            // breaker khula hai? (true = workers paused)
let probeTimer = null;
let lastLogAt = 0;

const isOutageError = (err) => OUTAGE_RE.test(String(err?.message || err || ""));

// Outage ke dauran log rate-limit karo — pehle yehi spam CPU/disk khata tha.
const logThrottled = (msg) => {
    const now = Date.now();
    if (now - lastLogAt < LOG_EVERY_MS) return;
    lastLogAt = now;
    console.log(msg);
};

const trip = (err) => {
    if (tripped) {
        logThrottled(`redis-guard: abhi bhi down (${workers.size} workers paused) => ${err?.message}`);
        return;
    }
    tripped = true;
    console.log(`redis-guard: Redis outage detect hua => "${err?.message}" — saare workers PAUSE.`);

    for (const [name, worker] of workers) {
        // pause(true) = active jobs ka wait mat karo (wo waise bhi fail honge).
        // Pause local flag hai, isliye Redis down hone par bhi kaam karta hai.
        Promise.resolve(worker.pause(true)).catch((e) => console.log(`redis-guard: ${name} pause fail => ${e?.message}`));
    }

    if (!probeTimer) {
        probeTimer = setInterval(probe, PROBE_MS);
        if (probeTimer.unref) probeTimer.unref(); // shutdown ko na roke
    }
};

let probing = false; // Redis full-down me set() offline queue me LATAK sakta hai -> overlap mat hone do

const probe = async () => {
    if (probing) return;
    probing = true;
    try {
        // WRITE probe (upar dekho kyun) — chhoti key, PX se apne aap saaf.
        await redis.set("redis:guard:probe", "1", "PX", PROBE_MS * 3);
    } catch (e) {
        logThrottled(`redis-guard: probe fail => ${e?.message}`);
        return; // abhi bhi down — agla probe try karega
    } finally {
        probing = false;
    }

    // Redis theek — breaker band karo, workers wapas chalu.
    clearInterval(probeTimer);
    probeTimer = null;
    tripped = false;
    console.log("redis-guard: Redis wapas aa gaya — saare workers RESUME.");

    for (const [name, worker] of workers) {
        Promise.resolve(worker.resume()).catch((e) => console.log(`redis-guard: ${name} resume fail => ${e?.message}`));
    }
};

// Har BullMQ worker banate hi yahan register karo. Guard uske error events khud
// sunta hai, taaki har worker file me alag-alag wiring na karni pade.
const registerWorker = (name, worker) => {
    workers.set(name, worker);
    worker.on("error", (err) => { if (isOutageError(err)) trip(err); });
};

// Kisi bhi jagah (connection error handler, unhandledRejection) se Redis-type
// error aaye to yahan report karo — outage ho to breaker trip hoga, warna no-op.
const reportRedisError = (err) => {
    if (isOutageError(err)) trip(err);
};

module.exports = { registerWorker, reportRedisError, isOutageError };
