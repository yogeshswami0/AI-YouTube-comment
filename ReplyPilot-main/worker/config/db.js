import mongoose from "mongoose";
import { env } from "./env.js";
import logger from "../utils/logger.js";

const MONGO_OPTIONS={
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    minPoolSize: 2
};

let isConnected = false;
async function connectdb() {
    if (isConnected) return;
    try {
        await mongoose.connect(env.MONGODB_URI, MONGO_OPTIONS);
        isConnected = true;
        console.log(`✅  Mongoose connected → ${mongoose.connection.name}`);
    } catch (error) {
        console.error(error.message);
        logger.error(error.message);
        throw error;
    }
}
async function disconnectdb() {
    if (!isConnected) return;
    try {
        await mongoose.disconnect();
        isConnected = false;
        console.log("Mongoose disconnected successfully!");
    } catch (error) {
        console.error(error.message);
        logger.error(error.message);
        throw error;
    }
}
mongoose.connection.on('disconnected', () => {
  isConnected = false;
  logger.warn('MongoDB disconnected — attempting reconnect...');
});

mongoose.connection.on('reconnected', () => {
  isConnected = true;
  logger.info('MongoDB reconnected');
});
export { connectdb, disconnectdb };
