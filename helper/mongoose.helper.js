const utils = require('./utils');
const adminSchema = require('../model/admin.model');
const shopSchema = require("../model/shop.model");
const userSchema = require("../model/user.model")


module.exports.createDefaultAdmin = async () => {

    const updateRequest = await userSchema.model.updateMany({ joinRequest: true }, { joinRequest: false });
    const totalBoat = await userSchema.model.find({ isBoat: true })
    if (totalBoat?.length < 2) await userSchema.model.insertMany([{ name: "Harry", isBoat: true }, { name: "Jerry", isBoat: true }])
}

module.exports.createShopItem = async () => {
    const shopArray = [
        {
            itemType: "coins",
            name: "",
            coins: 10000,
        },
        {
            itemType: "coins",
            name: "",
            coins: 50000,
        },
        {
            itemType: "coins",
            name: "",
            coins: 100000,
        },
        {
            itemType: "coins",
            name: "",
            coins: 500000,
        },
        {
            itemType: "coins",
            name: "",
            coins: 1000000,
        },
        {
            itemType: "diamond",
            name: "Yellow Diamond",
            coins: 1000000
        }, {
            itemType: "diamond",
            name: "Blue Diamond",
            coins: "",
            coins: 5000000
        },
        {
            itemType: "diamond",
            name: "Red Diamond",
            coins: "",
            coins: 10000000
        },
        {
            itemType: "gift",
            name: "Flowers",
            coins: 500
        },
        {
            itemType: "gift",
            name: "Juice",
            coins: 500
        },
        {
            itemType: "gift",
            name: "Coffee",
            coins: 500
        },
        {
            itemType: "gift",
            name: "Soda",
            coins: 500
        },
        {
            itemType: "gift",
            name: "Water",
            coins: 500
        },
        {
            itemType: "actions",
            name: "Throw Eggs",
            coins: 500
        },
        {
            itemType: "actions",
            name: "Throw Tomatoes",
            coins: 500
        },
        {
            itemType: "actions",
            name: "Water Splash",
            coins: 500
        },
        {
            itemType: "actions",
            name: "Gun Shot",
            coins: 500
        },
        {
            itemType: "actions",
            name: "Bomb Explosion",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 1",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 2",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 3",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 4",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 5",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 6",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 7",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 8",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 9",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 10",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 11",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 12",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 13",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 14",
            coins: 500
        },
        {
            itemType: "audio",
            name: "Audio 15",
            coins: 500
        },
        {
            itemType: "cardSkins",
            name: "Card Skin 1",
            coins: 500
        },
        {
            itemType: "cardSkins",
            name: "Card Skin 2",
            coins: 500
        },
        {
            itemType: "cardSkins",
            name: "Card Skin 3",
            coins: 500
        },
        {
            itemType: "cardSkins",
            name: "Card Skin 4",
            coins: 500
        },
        {
            itemType: "cardSkins",
            name: "Card Skin 5",
            coins: 500
        },
        {
            itemType: "cardSkins",
            name: "Card Skin 6",
            coins: 500
        }
    ]

    const checkShopItem = await shopSchema.model.find({});

    if (checkShopItem.length !== shopArray.length) {

        let insertArray = []

        shopArray.map(i => !checkShopItem.some(x => x.name === i.name) ? insertArray.push(i) : null)

        // shopArray.map(x => {
        //     insertArray.push({ itemType: x.itemType, name: x.name, coins: x.coins })
        // })

        shopSchema.model.insertMany(insertArray).then().catch()
    }
}