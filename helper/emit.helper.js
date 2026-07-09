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

module.exports = { userRoom, emitToUser };
