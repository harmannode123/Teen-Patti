const { socketEmit } = require('../../helper/appConstant');
const { socketUserAuthentication } = require('../../middleware/authentication');
const gameplayController = require('./gameplay.controller');
const userController = require('./user.controller');

module.exports.socketController = (io) => {

    // Authentication
    io.use(socketUserAuthentication);

    // Connection

    io.on(socketEmit.connection, (socket) => {

        const user = socket.user;
        const socketId = socket.id;
        console.log('::: Connection :::', user.name)

        // Is user ko uske personal room me daalo: "user:<userId>".
        // Ab is user ko bhejne ke liye socketId ki zaroorat nahi — room kaafi hai.
        // Reconnect par naya socket bhi yahi room join karega -> emit kabhi miss nahi hoga.
        socket.join(`user:${user._id}`);

        userController.notifySessionActive(user);


        //gameplayController.selfExit(io, user, socketId, false)

        // Join room (online or friend)
        // socket.on(socketEmit.joinRoom, async (data) => gameplayController.joinRoom(io, user, socketId, data));
        socket.on(socketEmit.joinRoom, async (data) => gameplayController.joinRoomNew(io, user, socketId, data));

        socket.on(socketEmit.placeBet, async (data) => gameplayController.placeBet(io, user, socketId, data));

        socket.on(socketEmit.seenCard, async (data) => gameplayController.seenCard(io, user, socketId, data));

        // ZHANDU: joker khulte rehte hain to best hand badalta rehta hai — client
        // jab chahe apna current best hand maang sakta hai (response bhi isi event pe).
        socket.on(socketEmit.fetchBestHand, async (data) => gameplayController.fetchBestHand(io, user, socketId, data));

        socket.on(socketEmit.sideShow, async (data) => gameplayController.sideShow(io, user, socketId, data));

        socket.on(socketEmit.respondToSideShow, async (data) => gameplayController.respondToSideShow(io, user, socketId, data));

        socket.on(socketEmit.fetchLobbyList, async (data) => gameplayController.fetchLobbyList(io, user, socketId, data));

        socket.on(socketEmit.watchRoom, async (data) => gameplayController.watchRoom(io, user, socketId, data));

        // Reconnect ke baad client current match state maangta hai (board resync).
        socket.on(socketEmit.resyncMatch, async (data) => gameplayController.resyncMatch(io, user, socketId, data));


        // Disconnection
        socket.on(socketEmit.disconnect, async () => gameplayController.selfExit(io, user, socketId, true));
        socket.on(socketEmit.selfExit, async () => gameplayController.selfExit(io, user, socketId, false));

    });
};