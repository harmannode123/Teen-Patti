// Admin panel ka login banane / password badalne ke liye — `admins` collection boot pe
// seed nahi hoti, isliye pehla admin isi se banta hai.
//
//   node tools/createAdmin.js admin@example.com 'StrongPassword'
//
// Email already ho to sirf password update hota hai (purane tokens apne aap invalid ho
// jaate hain, kyunki token me password hash hota hai).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const adminSchema = require("../model/admin.model");
const utils = require("../helper/utils");

(async () => {
    const [email, password] = process.argv.slice(2);
    if (!email || !password) {
        console.log("Usage: node tools/createAdmin.js <email> <password>");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_CONNECT_URL);
    const hash = await utils.hashPassword(password);
    const result = await adminSchema.model.updateOne({ email: email.toLowerCase() }, { password: hash }, { upsert: true });
    console.log(result.upsertedCount ? `Admin created: ${email}` : `Password updated: ${email}`);
    await mongoose.disconnect();
})().catch((e) => { console.log("createAdmin error =>", e.message); process.exit(1); });
