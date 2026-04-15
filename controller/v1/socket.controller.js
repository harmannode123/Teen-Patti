const { socketEmit } = require('../../helper/appConstant');
const { socketUserAuthentication } = require('../../middleware/authentication');
const gameplayController = require('./gameplay.controller');

module.exports.socketController = (io) => {

    // Authentication
    io.use(socketUserAuthentication);

    // Connection

    io.on(socketEmit.connection, (socket) => {

        const user = socket.user;
        const socketId = socket.id;
        console.log('::: Connection :::', user.name)


        //gameplayController.selfExit(io, user, socketId, false)

        // Join room (online or friend)
        // socket.on(socketEmit.joinRoom, async (data) => gameplayController.joinRoom(io, user, socketId, data));
        socket.on(socketEmit.joinRoom, async (data) => gameplayController.joinRoom(io, user, socketId, data));

        socket.on(socketEmit.placeBet, async (data) => gameplayController.placeBet(io, user, socketId, data));

        socket.on(socketEmit.seenCard, async (data) => gameplayController.seenCard(io, user, socketId, data));

        socket.on(socketEmit.sideShow, async (data) => gameplayController.sideShow(io, user, socketId, data));

        // Dash call
        //socket.on(socketEmit.dashCall, async (data) => gameplayController.dashCall(io, user, socketId, data));

        // Bid call
        // socket.on(socketEmit.bidCall, async (data) => gameplayController.bidRound(io, user, socketId, data));

        // // Self exit
        // socket.on(socketEmit.selfExit, async () => gameplayController.selfExit(io, user, socketId));

        // // Card played
        // socket.on(socketEmit.cardPlayed, async (data) => gameplayController.cardPlayed(io, user, socketId, data));

        // // Estimation Round
        // socket.on(socketEmit.estimation, async (data) => gameplayController.estimationBid(io, user, socketId, data));

        // // Estimation Round
        // socket.on(socketEmit.colorRoundestimationBid, async (data) => gameplayController.colorRoundestimationBid(io, user, socketId, data));

        // Disconnection
        socket.on(socketEmit.disconnect, async () => gameplayController.selfExit(io, user, socketId, true));
    });
};