const utils = require('./utils');
const adminSchema = require('../model/admin.model');
const userSchema = require("../model/user.model")
const matchSchema = require("../model/match.model");
const { roomList, variationList } = require("./appConstant");


module.exports.createDefaultAdmin = async () => {

    
    //await matchSchema.model.deleteMany({})

    const totalGameList = []
    roomList.map(x => {
        variationList.forEach(y => {
            totalGameList.push({
                ...x,
                variation: y?.name,
                bootAmount: y?.bootAmount
            })
        })
    })


    const newRooms = []
    for (let i = 1; i <= totalGameList.length; i++) newRooms.push({ roomId: i, roomName: totalGameList[i - 1]?.name, gameType: totalGameList[i - 1]?.gameType, variation: totalGameList[i - 1]?.variation, bootAmount: totalGameList[i - 1]?.bootAmount })

    const checkRoom = await matchSchema.model.find({});
    if (checkRoom.length === 0) {
        await matchSchema.model.insertMany(newRooms)
    }

}
