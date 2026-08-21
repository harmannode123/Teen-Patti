// PM2 cluster config — Teen Patti server.
//
// Maqsad: ek hi machine ke SAARE CPU cores use karna (har core ~ ek process).
// Socket.IO cluster-safe hai kyunki:
//   - per-user rooms + Redis adapter (app.js) -> cross-process emit kaam karta hai
//   - per-match Redis lock -> race conditions safe
//   - turn timer BullMQ (Redis) me hai -> kisi bhi process se fire/cancel
//
// STICKY SESSION: zaroorat NAHI. Unity WebGL client websocket-only transport
// (transports: ["websocket"]) use karta hai -> har connection single TCP socket
// jo ek hi process se chipka rehta hai. Isliye PM2 cluster mode (same port) seedha
// chalega, koi Nginx ip_hash sticky nahi chahiye.
//
// PORT: app.js `process.env.PORT` padhta hai (.env se). Cluster mode me saare
// instances yahi ek PORT share karte hain (Node cluster shared server handle).
//
// Chalane ke liye:
//   npm i -g pm2
//   pm2 start ecosystem.config.js                  # dev
//   pm2 start ecosystem.config.js --env production # prod
//   pm2 logs / pm2 status / pm2 reload teenpatti   # zero-downtime reload
//   pm2 stop teenpatti / pm2 delete teenpatti

module.exports = {
    apps: [
        {
            name: "teenpatti",
            script: "app.js",

            // Is machine me 2 cores hain isliye 2 instances. "max" mat karna —
            // HT/logical cores pe oversubscribe hota hai (zyada context-switch).
            // Naye server pe is number ko us machine ke physical cores ke barabar karo.
            instances: 2,
            exec_mode: "cluster",

            autorestart: true,
            max_memory_restart: "500M", // process is se zyada RAM le to restart

            // Crash loop me bina ruke restart na karta rahe.
            min_uptime: "10s",
            max_restarts: 10,

            // Sirf EK env hai — ye server hamesha production hi chalta hai.
            // Isliye `pm2 start ecosystem.config.js` seedha kaafi hai, koi
            // `--env production` flag nahi chahiye.
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
