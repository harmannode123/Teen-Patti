// User ko emit bhejne ka simple, reconnect-safe tareeka.
//
// Purana tareeka: io.to(socketId).emit(...) -> socketId reconnect par badal jaati
// hai, to purani socketId par bheja emit kahin nahi pahunchta.
//
// Naya tareeka: har user ek "room" me hota hai jiska naam `user:<userId>` hai.
// Hum room ko emit karte hain. Reconnect par naya socket bhi wahi room join karta
// hai, to Socket.IO khud sahi (current) socket dhoondh ke bhej deta hai.
// Bonus: cluster (multiple server) me bhi Redis-adapter ke saath kaam karega.

const userRoom = (userId) => `user:${userId}`;

const emitToUser = (io, userId, event, data) => {
    if (!userId) return; // userId nahi hai to kuch mat karo
    io.to(userRoom(userId)).emit(event, data);
};

// User abhi live hai ya nahi.
// Har socket connect hote hi `user:<id>` room join karta hai -> room me socket hai
// matlab banda connected hai. Redis adapter ki wajah se ye poore PM2 cluster ka
// jawab deta hai (isi liye async hai).
//
// Redis gir jaye to sab offline gine jaayenge — chalega, kyunki Redis ke bina to
// BullMQ, lock aur match cache bhi band hi pade hain. Throw nahi karte, warna poora
// startNextRound hi ruk jaayega.
//
// ⚠️ `allSockets()` MAT use karna: @socket.io/redis-adapter v8 `sockets()` override nahi
// karta, to wo sirf ISI process ke sockets deta hai. PM2 ke 2 instances pe teen bande
// connected the, par har process ko sirf apne wale online dikhe -> startNextRound ne
// baaki ko naye match se nikaal diya. `fetchSockets()` adapter se saare nodes se poochta hai.
const isUserOnline = async (io, userId) => {
    if (!userId) return false;
    try {
        const sockets = await io.in(userRoom(userId)).fetchSockets();
        return sockets.length > 0;
    } catch (err) {
        console.error("isUserOnline failed =>", err && err.message);
        return false;
    }
};

// List me se sirf live wale ids (string) wapas. Ids ya player objects, dono chalte hain.
// Ek hi fetchSockets saare user rooms pe — har user ke liye alag cluster round-trip nahi.
const filterOnlineUsers = async (io, userIds = []) => {
    if (!Array.isArray(userIds) || !userIds.length) return [];

    const ids = userIds.filter(Boolean).map((x) => String(x._id || x));
    try {
        const sockets = await io.in(ids.map(userRoom)).fetchSockets();
        const online = new Set();
        sockets.forEach((s) => s.rooms.forEach((r) => online.add(r)));
        return ids.filter((id) => online.has(userRoom(id)));
    } catch (err) {
        console.error("filterOnlineUsers failed =>", err && err.message);
        return [];
    }
};

module.exports = { userRoom, emitToUser, isUserOnline, filterOnlineUsers };
