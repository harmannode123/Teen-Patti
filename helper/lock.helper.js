// Per-match distributed lock (taala) using Redis.
//
// Problem: do players ek saath action karein to dono purana match padhke
// alag-alag update kar dete hain -> data corrupt (race condition).
//
// Solution: kisi match par kaam karne se pehle uska "taala" lo. Jab tak
// pehla banda kaam kar raha hai, doosra wait karega. Kaam khatam -> taala chhodo.
//
// Yeh Redis me kaam karta hai isliye SAARE processes (cluster) me kaam karega,
// sirf ek process ki memory tak limited nahi.

const redis = require("./redis.helper");

// Chhota helper: x milliseconds ke liye ruko (Promise based sleep).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Ek match ka taala lene ki koshish karo.
//   matchId      -> kis match ka taala
//   ttlMs        -> taala max kitni der rahega (safety: agar crash ho to apne aap khul jaye)
//   maxWaitMs    -> taala na mile to kitni der tak try karte rahein
//
// Return: ek "token" (unique string) jo taala chhodte waqt chahiye, ya null (taala nahi mila).
const acquireLock = async (matchId, ttlMs = 5000, maxWaitMs = 3000) => {
    const key = `lock:match:${matchId}`;

    // Unique token: sirf wahi process taala khol sake jisne lagaya tha.
    // (Date.now + random taaki har token alag ho.)
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const startedAt = Date.now();

    // Jab tak maxWaitMs khatam na ho, taala lene ki koshish karte raho.
    while (Date.now() - startedAt < maxWaitMs) {
        // SET key token NX PX ttl
        //   NX = sirf tabhi set karo jab key pehle se na ho (matlab taala khaali ho)
        //   PX = ttlMs ke baad key apne aap delete (safety, deadlock se bachne ke liye)
        // Agar "OK" mila -> taala humein mil gaya.
        const ok = await redis.set(key, token, "PX", ttlMs, "NX");

        if (ok === "OK") return token; // taala mil gaya

        // Taala kisi aur ke paas hai -> thoda ruko, phir dobara try karo.
        await sleep(50);
    }

    // maxWaitMs me bhi taala nahi mila.
    return null;
};

// Taala chhodo. Sirf wahi token jisne lagaya tha taala khol sakta hai.
// (Yeh Lua script atomic hai: "agar value mera token hai TABHI delete karo".
//  Isse galti se kisi aur ka taala nahi khulta jo TTL ke baad re-acquire ho gaya ho.)
const releaseLockScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

const releaseLock = async (matchId, token) => {
    if (!token) return;
    const key = `lock:match:${matchId}`;
    try {
        await redis.eval(releaseLockScript, 1, key, token);
    } catch (err) {
        console.log("releaseLock error =>", err.message);
    }
};

// Sabse aasaan tareeka use karne ka: withLock(matchId, async () => { ...kaam... })
// Yeh khud taala leta hai, kaam chalata hai, aur kaam ke baad (error me bhi) taala chhod deta hai.
const withLock = async (matchId, fn) => {
    const token = await acquireLock(matchId);
    if (!token) {
        // Taala nahi mila -> abhi koi aur isi match par kaam kar raha hai.
        throw new Error("Match busy, please retry.");
    }
    try {
        return await fn();
    } finally {
        // finally = chahe kaam pass ho ya error aaye, taala HAMESHA chhodo.
        await releaseLock(matchId, token);
    }
};

module.exports = { acquireLock, releaseLock, withLock };
