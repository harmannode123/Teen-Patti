// Redis connection helper
// Poore app me sirf YEH ek hi Redis connection use hoga (singleton).
// Baar-baar naya connection banana mehnga hai, isliye ek hi banake export karte hain.

const Redis = require("ioredis");

// .env me REDIS_URL ho to wahi use karo, warna local Redis (127.0.0.1:6379) maan lo.
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// Yeh asli connection object hai. Iske through hum Redis me set/get/lock sab karenge.
const redis = new Redis(redisUrl, {
    // Agar Redis temporarily down ho to ioredis automatic retry karta hai.
    // Yeh function batata hai ki kitni der baad retry kare (milliseconds me).
    // times = abhi tak kitni baar try kiya. Har baar thoda zyada ruko, max 2 sec.
    retryStrategy: (times) => Math.min(times * 200, 2000),
});

// Jab connection ban jaye to ek baar log karo (debugging ke liye).
redis.on("connect", () => console.log("----- Redis connected. -----"));

// Agar koi error aaye (Redis down hai, galat URL hai) to crash mat karo, bas log karo.
redis.on("error", (err) => console.log("Redis error =>", err.message));

module.exports = redis;
