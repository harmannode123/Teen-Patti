const matchSchema = require("../model/match.model");
const { roomList } = require("./appConstant");

module.exports.createDefaultAdmin = async () => {

    // roomList -> flat rooms (ek level = ek room doc)
    const allRooms = []
    for (const game of roomList) {
        for (const level of game.level) {
            allRooms.push({
                roomId: level.roomId,
                roomName: game.name,
                gameType: game.gameType,
                variation: level.name,
                bootAmount: level.bootAmount,
                entryAmount: level.entryAmount,
                betLimit: level.betLimit,
                vMode: game.vMode || false
            })
        }
    }

    // Match table me kaunsi roomId already hai
    const existingIds = await matchSchema.model.distinct("roomId")

    // Jo roomId missing hai sirf wahi insert karo
    const missingRooms = allRooms.filter(room => !existingIds.includes(room.roomId))
    if (missingRooms.length > 0) await matchSchema.model.insertMany(missingRooms)

}
