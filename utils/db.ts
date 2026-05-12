import mongoose from 'mongoose';
require('dotenv').config();

const dbUrl:string = process.env.DB_URL || '';

const connectDB = async () => {
    try {
        await mongoose.connect(dbUrl, {
            family: 4,                      // force IPv4 DNS — fixes ETIMEOUT on many networks
            serverSelectionTimeoutMS: 10000,
        }).then((data:any) => {
            console.log(`Database connected with ${data.connection.host}`)
        })
    } catch (error:any) {
        console.log(error.message);
        setTimeout(connectDB, 5000);
    }
}

export default connectDB;