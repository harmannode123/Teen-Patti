const admin = require('firebase-admin')

module.exports.sendFcmNotification = (title, body, data, token) => {

    const message = {
        notification: { title, body, },
        data: { 'data': JSON.stringify(data) },
        token
    }
    return admin.messaging().send(message).then().catch(err => console.log("::::: Fcm notification error :::::"));
}