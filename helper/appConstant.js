// API resposne status codes
module.exports.responseStatus = {
    success: 200,
    created: 201,
    unAuthorized: 401,
    forbidden: 403,
    badRequest: 400,
    internalServerError: 500,
    notFound: 404,
};

// Socket meit constant
module.exports.socketEmit = {

    connection: "connection",
    joinRoom: "joinRoom",
    disconnect: "disconnect",
    joinRoomSuccess: "joinRoomSuccess",
    selfExitSuccess: 'selfExitSuccess',
    cardPlayed: 'cardPlayed',
    cardPlayedSuccess: 'cardPlayedSuccess',
    selfExit: 'selfExit',
    error: "error",
    errorLog: "errorLog",

    roomDiscard: "roomDiscard",
    matchStart: "matchStart",
    dashCall: "dashCall",
    bidCall: 'bidCall',
    bidCallSuccess: 'bidCallSuccess',
    estimationSuccess: 'estimationSuccess',
    estimation: 'estimation',
    dashCallSuccess: 'dashCallSuccess',
    turn: 'turn',
    betTurn: "betTurn",
    trick: 'trick',
    coinsUpdate: "coinsUpdate",
    roundWinner: "roundWinner",
    roundResult: "roundResult",
    gameResult: "gameResult",
    colorRoundestimationBid: "colorRoundEstimationBid",
    gameOver: "gameOver",
    scoreDifference: 'scoreDifference',
    avoidPlayers: "avoidPlayers",
    cardDistributeSuccess: "cardDistributeSuccess",
    placeBet: "placeBet",
    successPlaceBet: "successPlaceBet",
    seenCard: "seenCard",
    seenCardSuccess: "seenCardSuccess",
    sideShow: "sideShow",
    sideShowRequest: "sideShowRequest",
    rejectSideShow: "rejectSideShow",
    acceptSideShow: "acceptSideShow",
    sideShowWinner: "sideShowWinner",

}

// Constant messages
module.exports.messagesEnglish = {

    // App messages
    appName: "Estimation Kingdom",
    emailVerification: "Email Verification",
    resetPassword: "Reset Password",

    // Authentication
    loginSessionExpired: "Login session has been expired, Please login again.",
    invalidCredentials: "Please enter valid email address and password.",
    accountBlockedByAdmin: "Your account has been blocked by the admin.",
    emailNotRegisteredWithUs: "This email address is not registered with us.",
    otpSent: "OTP has been sent to your registered email address.",
    invalidOtp: "Please enter valid OTP.",
    otpVerified: "OTP has been verified successfully.",
    resetPasswordLinkSent: "Reset password link has been sent to your registered email address.",
    loggedOut: "Logged out successfully.",
    loggedIn: "Logged in successfully.",
    invalidCountryCode: "Please enter valid country code.",
    invalidPhone: "Please enter valid phone number.",
    profileUpdated: "Profile details has been updated successfully.",
    emailAlreadyExist: "Email address already exist.",
    phoneAlreadyExist: "Phone number already exist.",
    invalidToken: "Please enter valid token.",
    userNameAlreadyExist: "Username already exist.",
    invalidPasswordValidation: "Password must include 8 characters, 1 upper case letter, 1 lower case letter, 1 numeric value, 1 special character and no spaces.",
    resetPasswordlinkExpired: "Reset password link has been expired.",
    passwordUpdated: "Password has been updated successfully.",
    emailVerificationLinkSent: "Email verification link has been sent to you registered email address.",
    tokenExpired: "Token has been expired.",
    accountDeleted: "Account has been deleted successfully.",
    profileUpdated: "Profile has been updated successfully.",
    phoneVerified: "Phone number has been verified successfully.",
    profileFetched: "Profile details has been fetched successfully.",
    userNotFound: "User not found.",
    invalidOldPassword: "Please enter valid old password.",
    oldPasswordCannotBeSameAsNewPassword: "New password cannot be same as old password.",
    linkFetched: "Link has been fetched successfully.",
    rewardsUpdated: "Congratulations! You have earned 1000 coins as your reward.",

    // friend
    friendRequestSend: "Friend request has been sent successfully.",
    alreadyFriend: "You are already friend with this user.",
    friendRequestAlreadySent: "Friend request has been already sent.",
    friendRequestAlreadyReceived: "You have already received a friend request from this user.",
    friendRequestNotFound: "Friend request not found.",
    friendRequestAccepted: "Friend request accepted successfully.",
    friendRequestRejected: "Friend request rejected successfully.",
    friendRequestCancelled: "Friend request cancelled successfully.",
    friendRemoved: "Friend has been removed successfully.",
    usersFetched: "Users has been fetched successfully.",
    friendRequest: "Friend request",
    friendRequestAccepted: "Friend request accepted",
    sentYouFriendRequest: "sent you a friend request.",
    acceptedYourFriendRequest: "accepted your friend request.",
    matchNotFound: "Match not found.",

    // Gameplay messages
    roomDiscarded: "Room has been discarded.",
    sendMessage: "Message has been send successfully.",


    // Admin messages
    userBlocked: "User has been blocked successfully.",
    userUnblocked: "User has been unblocked successfully.",
    userDetailsUpdated: "User details has been updated successfully.",
    dashboardFetched: "Dashboard fetched successfully.",
    announcementCreated: "Announcement has been created successfully.",
    coinsUpdated: "User coins updated.",


    roomCreated: "Room has been created successfully.",
    sendInvitation: 'Invitations has been send successfully.',
    roomNotFound: 'Room not found.',
    selectPlayers: 'Please select the players.',

    //shop item messages 
    invalidShop: "Invalid shop item.",
    itemPurchase: "Item has been purchased successfully.",
    lessCoin: "Insufficient coins to complete the purchase.",
    shopListFetch: "Shop item list has been fetched successfully.",
    subscriptionPurchase: "Your VIP subscription has been purchased successfully.",
    alreadyPurchaseSubs: "Subscription has been already purchased.",
    insufficientGift: "You have an insufficient amount of this gift."

};

module.exports.RoundTrumpSuit = {
    14: "sans",
    15: "spade",
    16: "heart",
    17: "diamond",
    18: "clubs"
}

module.exports.suits = {
    "sans": "sans",
    "spade": "spades",
    "heart": "hearts",
    "diamond": "diamond",
    "clubs": "clubs"

}



module.exports.gameConfig = {
    maxPlayer: 8,
    minPlayer: 2,
    bootAmount: 10,
    gameStartAfterCreate: 15000,
}




