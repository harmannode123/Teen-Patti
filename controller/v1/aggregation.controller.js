// dependencies
const friendSchema = require('../../model/friend.model');
const userSchema = require('../../model/user.model');
const adminSchema = require('../../model/admin.model');
const notificationSchema = require('../../model/notification.model');
const utils = require('../../helper/utils');
const moment = require('moment');
const { purchaseShopType, } = require('../../helper/appConstant');


// Profile
module.exports.profile = (user) => {

    const aggregationArray = [

        {
            $match: {
                _id: utils.parseMongoObjectId(user)
            }
        },
        {
            $lookup: {
                from: "purchasecoins",
                localField: "_id",
                foreignField: "user",
                pipeline: [
                    {
                        $match: {
                            type: purchaseShopType.subscription,
                            validUpto: { $gte: new Date(moment().utc()) }
                        }
                    }
                ],
                as: "subscribePlan"
            }
        },
        {
            $lookup: {
                from: "notifications",
                localField: "_id",
                foreignField: "to",
                pipeline: [
                    {
                        $match: {
                            seen: false

                        }
                    }
                ],
                as: "notificationCount"
            }
        },

        {
            $project: {
                _id: 1,
                email: 1,
                countryCode: { $cond: ["$countryCode", "$countryCode", ''] },
                phone: { $cond: ["$phone", "$phone", ''] },
                emailVerified: 1,
                phoneVerified: 1,
                name: 1,
                userName: "$name",
                image: { $cond: ["$image", "$image", ''] },
                dob: 1,
                avatarId: { $cond: ["$avatarId", "$avatarId", ''] },
                country: { $cond: ["$country", "$country", ''] },
                coins: 1,
                diamonds: 1,
                xp: 1,
                imageType: { $cond: ["$imageType", "$imageType", ''] },
                isSubscribed: { $gt: [{ $size: "$subscribePlan" }, 0] },
                blueDiamond: 1,
                yellowDiamond: 1,
                redDiamond: 1,
                score: '$xp',
                notificationCount: { $size: "$notificationCount" }
            }

        }
    ]

    return userSchema.model.aggregate(aggregationArray);
};

// Get user details with connection and block status
module.exports.findUserWithStatus = (self, other) => {

    const aggregationArray = [
        {
            $match: {

                _id: utils.parseMongoObjectId(other),
                deletedAt: null,
                isBlock: false
            }
        },
        {
            $lookup: {
                from: "friends",
                as: "friend",
                pipeline: [

                    {
                        $match: {
                            $or: [
                                {
                                    from: utils.parseMongoObjectId(self),
                                    to: utils.parseMongoObjectId(other)
                                },
                                {
                                    to: utils.parseMongoObjectId(self),
                                    from: utils.parseMongoObjectId(other)
                                }
                            ]
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            from: 1,
                            to: 1,
                            isAccepted: 1
                        }
                    }
                ]
            }
        },
        {
            $unwind: {
                path: "$friend",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $lookup: {
                from: "notifications",
                localField: "_id",
                foreignField: "to",
                pipeline: [
                    {
                        $match: {
                            seen: false
                        }
                    }
                ],
                as: "count"

            }
        },
        {
            $project: {
                _id: 1,
                fcmToken: 1,
                friendRequestId: "$friend._id",
                alreadyFriend: { $eq: ["$friend.isAccepted", true] },
                friendRequestSent: {
                    $and: [
                        { $eq: ["$friend.from", utils.parseMongoObjectId(self)] },
                        { $eq: ["$friend.isAccepted", false] }
                    ]
                },
                friendRequestReceived: {
                    $and: [
                        { $eq: ["$friend.to", utils.parseMongoObjectId(self)] },
                        { $eq: ["$friend.isAccepted", false] }
                    ]
                },
                socketId: 1,
                notificationCount: { $size: "$count" }
            }
        }
    ];

    return userSchema.model.aggregate(aggregationArray);
};

// Sent friend request list
module.exports.sentFriendRequestList = (user, offset, limit, search) => {

    const aggregationArray = [
        {
            $match: {

                from: utils.parseMongoObjectId(user)
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "to",
                foreignField: "_id",
                as: "user",
                pipeline: [

                    {
                        $match: {
                            deletedAt: null,
                            isBlock: false,
                            ...(search ? {
                                $or: [
                                    { name: { $regex: new RegExp(('.*' + search + '.*'), "i") } },
                                    { userName: { $regex: new RegExp(('.*' + search + '.*'), "i") } }
                                ]
                            } : {})
                        }
                    },
                    {
                        $lookup: {
                            from: 'rooms',
                            localField: '_id',
                            foreignField: 'winner',
                            as: 'wins'
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            name: 1,
                            image: 1,
                            userName: 1,
                            wins: { $size: "$wins" },
                            avatarId: 1,
                            imageType: 1
                        }
                    }
                ]
            }
        },
        {
            $unwind: {
                path: "$user",
            }
        },
        {
            $project: {
                _id: 1,
                user: 1
            }
        },
        {
            $skip: offset
        },
        {
            $limit: limit
        },
        {
            $replaceRoot: {
                newRoot: "$user"
            }
        }
    ];

    return friendSchema.model.aggregate(aggregationArray);
};

// Received friend request list
module.exports.receivedFriendRequestList = (self, offset, limit, search) => {

    const aggregationArray = [
        {
            $match: {

                to: utils.parseMongoObjectId(self),
                isAccepted: false
            }
        },
        {
            $sort: {
                createdAt: -1
            }
        },
        {
            $lookup: {
                from: "users",
                localField: "from",
                foreignField: "_id",
                as: "user",
                pipeline: [

                    {
                        $match: {
                            deletedAt: null,
                            isBlock: false,
                            ...(search ? {
                                $or: [
                                    { name: { $regex: new RegExp(('.*' + search + '.*'), "i") } },
                                    { userName: { $regex: new RegExp(('.*' + search + '.*'), "i") } }
                                ]
                            } : {})
                        }
                    },
                    {
                        $lookup: {
                            from: 'rooms',
                            localField: '_id',
                            foreignField: 'winner',
                            as: 'wins'
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            name: 1,
                            userName: 1,
                            image: 1,
                            wins: { $size: "$wins" },
                            avatarId: 1,
                            imageType: 1
                        }
                    }
                ]
            }
        },
        {
            $unwind: {
                path: "$user",
            }
        },
        {
            $project: {
                _id: 1,
                user: 1
            }
        },
        {
            $skip: offset
        },
        {
            $limit: limit
        },
        {
            $replaceRoot: {
                newRoot: "$user"
            }
        }
    ];

    return friendSchema.model.aggregate(aggregationArray);
};

// Friend list
module.exports.friendList = (user, offset, limit, search) => {

    const aggregationArray = [
        {
            $match: {

                $or: [
                    { to: utils.parseMongoObjectId(user) },
                    { from: utils.parseMongoObjectId(user) },
                ],
                isAccepted: true
            }
        },
        {
            $sort: {
                createdAt: -1
            }
        },
        {
            $lookup: {
                from: "users",
                let: { "user": { $cond: [{ $eq: ["$to", utils.parseMongoObjectId(user)] }, "$from", "$to"] } },
                as: "user",
                pipeline: [

                    {
                        $match: {
                            $expr: {
                                $eq: ["$_id", "$$user"]
                            },
                            deletedAt: null,
                            isBlock: false,
                            ...(search ? {
                                $or: [
                                    { name: { $regex: new RegExp(('.*' + search + '.*'), "i") } },
                                    { userName: { $regex: new RegExp(('.*' + search + '.*'), "i") } }
                                ]
                            } : {})
                        }
                    },
                    {
                        $lookup: {
                            from: 'rooms',
                            localField: '_id',
                            foreignField: 'winner',
                            as: 'wins'
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            name: 1,
                            image: 1,
                            userName: 1,
                            wins: { $size: '$wins' },
                            yellowDiamond: 1,
                            blueDiamond: 1,
                            redDiamond: 1,
                            badgeCount: {
                                $switch: {
                                    branches: [
                                        { case: { $and: [{ $gte: ["$xp", 0] }, { $lte: ["$xp", 100] }] }, then: 0 },
                                        { case: { $and: [{ $gte: ["$xp", 101] }, { $lte: ["$xp", 300] }] }, then: 1 },
                                        { case: { $and: [{ $gte: ["$xp", 301] }, { $lte: ["$xp", 1000] }] }, then: 2 },
                                        { case: { $and: [{ $gte: ["$xp", 1001] }, { $lte: ["$xp", 2500] }] }, then: 3 },
                                        { case: { $and: [{ $gte: ["$xp", 2501] }, { $lte: ["$xp", 6000] }] }, then: 4 },
                                        { case: { $and: [{ $gte: ["$xp", 6001] }, { $lte: ["$xp", 12000] }] }, then: 5 },
                                    ],
                                    default: 6 // if none of the cases match, return 6
                                }
                            },
                            avatarId: 1,
                            imageType: 1

                        }
                    }
                ]
            }
        },
        {
            $unwind: {
                path: "$user",
            }
        },
        {
            $project: {
                _id: 1,
                user: 1
            }
        },
        {
            $skip: offset
        },
        {
            $limit: limit
        },
        {
            $replaceRoot: {
                newRoot: "$user"
            }
        }
    ];

    return friendSchema.model.aggregate(aggregationArray);
};

// Leaderboard
module.exports.leaderBoard = (offset, limit, type) => {

    let matchObject = Object.assign({})
    console.log('type', type)
    switch (type) {
        case 'daily':
            matchObject['createdAt'] = { $gte: new Date(moment().startOf('day')), $lte: new Date(moment().endOf('day')) }
            break;

        case 'monthly':
            matchObject['createdAt'] = { $gte: new Date(moment().startOf('month')), $lte: new Date(moment().endOf('month')) }
            break;

        case 'weekly':
            matchObject['createdAt'] = { $gte: new Date(moment().startOf('week')), $lte: new Date(moment().endOf('week')) }
            break;

        case 'yearly':
            matchObject['createdAt'] = { $gte: new Date(moment().startOf('year')) }
            break;

        default:
            break;
    }


    const aggregationArray = [
        {
            $match: {
                isBlock: false,
                delatedAt: null,
                userName: { $ne: null },
            }
        },
        {
            $lookup: {
                from: 'rooms',
                localField: '_id',
                let: { user: '$_id' },
                foreignField: 'players',
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $eq: ['$winner', '$$user']
                            },
                            ...matchObject
                        }
                    }
                ],
                as: 'wins'
            }
        },
        {
            $addFields: {
                wins: { '$size': '$wins' }
            }
        },
        {
            $sort: {
                wins: -1
            }
        },
        {
            $skip: offset || 0
        },
        {
            $limit: limit || 10
        },
        {
            $project: {
                _id: 1,
                name: 1,
                wins: 1,
                userName: 1,
                image: 1,
                score: '$xp',
                coins: 1,
                diamonds: 1,
                imageType: 1
            }
        }
    ]

    return userSchema.model.aggregate(aggregationArray);
};

// Search user
module.exports.searchUser = (user, offset, limit, search) => {

    const aggregationArray = [

        {
            $match: {
                _id: { $ne: utils.parseMongoObjectId(user) },
                isBlock: false,
                delatedAt: null,
                userName: { $ne: null },
                ...(search ? {
                    $or: [
                        { name: { $regex: new RegExp(('.*' + search + '.*'), "i") } },
                        { userName: { $regex: new RegExp(('.*' + search + '.*'), "i") } }
                    ]
                } : {})
            }
        },
        {
            $sort: {
                createdAt: -1
            }
        },
        {
            $skip: offset
        },
        {
            $limit: limit
        },
        {
            $lookup: {
                from: "friends",
                as: "friend",
                let: { "user": "$_id" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $or: [
                                    {
                                        $and: [
                                            { $eq: ["$from", utils.parseMongoObjectId(user)] },
                                            { $eq: ["$to", "$$user"] }
                                        ]
                                    },
                                    {
                                        $and: [
                                            { $eq: ["$to", utils.parseMongoObjectId(user)] },
                                            { $eq: ["$from", "$$user"] }
                                        ]
                                    }
                                ]
                            }
                        }
                    },
                    {
                        $project: {
                            _id: 1,
                            from: 1,
                            to: 1,
                            isAccepted: 1
                        }
                    }
                ]
            }
        },
        {
            $unwind: {
                path: "$friend",
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $lookup: {
                from: 'rooms',
                localField: '_id',
                foreignField: 'winner',
                as: 'wins'
            }
        },
        {
            $project: {
                _id: 1,
                name: 1,
                userName: 1,
                image: 1,
                isFriend: { $eq: ["$friend.isAccepted", true] },
                requestSent: {
                    $and: [
                        { $eq: ["$friend.isAccepted", false] },
                        { $eq: ["$friend.from", utils.parseMongoObjectId(user)] },
                    ]
                },
                requestReceived: {
                    $and: [
                        { $eq: ["$friend.isAccepted", false] },
                        { $eq: ["$friend.to", utils.parseMongoObjectId(user)] },
                    ]
                },
                score: '$xp',
                wins: { $size: "$wins" },
                coins: 1,
                redDiamond: 1,
                blueDiamond: 1,
                yellowDiamond: 1,
                badgeCount: {
                    $switch: {
                        branches: [
                            { case: { $and: [{ $gte: ["$xp", 0] }, { $lte: ["$xp", 100] }] }, then: 0 },
                            { case: { $and: [{ $gte: ["$xp", 101] }, { $lte: ["$xp", 300] }] }, then: 1 },
                            { case: { $and: [{ $gte: ["$xp", 301] }, { $lte: ["$xp", 1000] }] }, then: 2 },
                            { case: { $and: [{ $gte: ["$xp", 1001] }, { $lte: ["$xp", 2500] }] }, then: 3 },
                            { case: { $and: [{ $gte: ["$xp", 2501] }, { $lte: ["$xp", 6000] }] }, then: 4 },
                            { case: { $and: [{ $gte: ["$xp", 6001] }, { $lte: ["$xp", 12000] }] }, then: 5 },
                        ],
                        default: 6 // if none of the cases match, return 6
                    }
                },
                avatarId: 1,
                imageType: 1
            }
        },
        {
            $match: {
                isFriend: false
            }
        }
    ]

    return userSchema.model.aggregate(aggregationArray);
};

// User list for admin
module.exports.usersListForAdmin = (offset, limit, sort, order, search) => {

    const aggregationArray = [

        ...(search ? [
            {
                $match: {
                    $or: [
                        {
                            name: { $regex: new RegExp(".*" + search + ".*", "i") },
                        },
                        {
                            userName: { $regex: new RegExp(".*" + search + ".*", "i") },
                        },
                        {
                            email: { $regex: new RegExp(".*" + search + ".*", "i") },
                        }
                    ],
                },
            }
        ] : []),
        {
            $sort: { [sort || "createdAt"]: order || -1 }
        },
        {
            $project: {
                _id: 1,
                email: 1,
                countryCode: 1,
                phone: 1,
                name: 1,
                userName: 1,
                image: 1,
                dob: 1,
                country: 1,
                isBlock: 1
            }

        },
        {
            $facet: {
                data: [{ $skip: offset }, { $limit: limit }],
                totalCount: [
                    {
                        $count: "count",
                    },
                ],
            },
        },
        {
            $unwind: {
                path: "$totalCount",
            },
        },
    ]

    return userSchema.model.aggregate(aggregationArray);
};

// User details for admin
module.exports.userDetailsForAdmin = (user) => {

    const aggregationArray = [

        {
            $match: {
                _id: utils.parseMongoObjectId(user)
            }
        },
        {
            $project: {
                _id: 1,
                email: 1,
                countryCode: 1,
                phone: 1,
                name: 1,
                userName: 1,
                image: 1,
                dob: 1,
                avatarId: 1,
                country: 1,
                coins: 1,
                diamonds: 1
            }

        }
    ]

    return userSchema.model.aggregate(aggregationArray);
};

// Dashboard
module.exports.dashboard = (user) => {

    const aggregationArray = [

        {
            $match: {
                _id: utils.parseMongoObjectId(user)
            }
        },
        {
            $lookup: {
                from: "users",
                as: "users",
                pipeline: [
                    {
                        $project: {
                            _id: 1,
                            createdAt: 1
                        }
                    }
                ]
            }
        },
        {
            $project: {
                _id: 0,
                user: {
                    totalUsers: { $size: "$users" },
                    today: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('day'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('day'))]
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    thisWeek: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('week'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('week'))]
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    thisMonth: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('month'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('month'))]
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    thisQuarter: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('quarter'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('quarter'))]
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    thisYear: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('year'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('year'))]
                                        }
                                    ]
                                }
                            }
                        }
                    }
                },
                game: {
                    totalUsers: { $size: "$users" },
                    today: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('day'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('day'))]
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    thisWeek: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('week'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('week'))]
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    thisMonth: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('month'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('month'))]
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    thisQuarter: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('quarter'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('quarter'))]
                                        }
                                    ]
                                }
                            }
                        }
                    },
                    thisYear: {
                        $size: {
                            $filter: {
                                input: "$users",
                                as: "user",
                                cond: {
                                    $and: [
                                        {
                                            $gte: ["$$user.createdAt", new Date(moment().utc().startOf('year'))]
                                        },
                                        {
                                            $lte: ["$$user.createdAt", new Date(moment().utc().endOf('year'))]
                                        }
                                    ]
                                }
                            }
                        }
                    }
                }
            }
        }
    ]

    return adminSchema.model.aggregate(aggregationArray);
};

// User list for admin
module.exports.announcementListForAdmin = (offset, limit, sort, order, search) => {

    const aggregationArray = [

        {
            $match: {
                announcement: true,
                ...(search ?
                    {
                        $or: [
                            {
                                title: { $regex: new RegExp(".*" + search + ".*", "i") },
                            },
                            {
                                description: { $regex: new RegExp(".*" + search + ".*", "i") },
                            }
                        ]
                    }
                    : {}),
            }
        },
        ...(search ? [
            {
                $match: {
                    $or: [
                        {
                            title: { $regex: new RegExp(".*" + search + ".*", "i") },
                        },
                        {
                            description: { $regex: new RegExp(".*" + search + ".*", "i") },
                        }
                    ]
                },
            }
        ] : []),
        {
            $sort: { [sort || "createdAt"]: order || -1 }
        },
        {
            $project: {
                _id: 1,
                title: 1,
                description: 1,
                createdAt: 1
            }
        },
        {
            $facet: {
                data: [{ $skip: offset }, { $limit: limit }],
                totalCount: [
                    {
                        $count: "count",
                    },
                ],
            },
        },
        {
            $unwind: {
                path: "$totalCount",
            },
        },
    ]

    return notificationSchema.model.aggregate(aggregationArray);
};
