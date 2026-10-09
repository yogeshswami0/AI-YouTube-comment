import { connectdb, disconnectdb } from "./config/db.js";
import logger from "./utils/logger.js";
import workers from "./tasks/index.js";
import { initScheduler, schedulerWorker } from "./tasks/scheduler.js";

const MAX_RETRY_DELAY_MS = 60_000;   // cap at 60 seconds
const INITIAL_RETRY_DELAY_MS = 5_000; // start at 5 seconds

async function startWorker() {
    let attempt = 0;

    while (true) {
        try {
            attempt++;
            // Connect to Database
            await connectdb();
            logger.info("Worker process connected to MongoDB");

            // Initialize the recurring scheduler
            await initScheduler();

            // The workers are already initialized when imported from ./tasks/index.js
            // We just need to keep the process alive and handle shutdown
            logger.info("BullMQ Worker Service started successfully");
            return; // success — exit the retry loop

        } catch (error) {
            const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
            logger.warn(
                `Failed to start worker service (attempt ${attempt}): ${error.message}. ` +
                `Retrying in ${delay / 1000}s...`
            );
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

// Graceful shutdown
const shutdown = async (signal) => {
    logger.info(`${signal} received. Shutting down worker process...`);

    try {
        // 1. Close BullMQ workers (stop accepting new jobs)
        const allWorkers = [...workers, schedulerWorker];
        await Promise.all(allWorkers.map((w) => {
            logger.info(`Closing worker: ${w.name}`);
            return w.close();
        }));
        logger.info("All BullMQ workers closed.");

        // 2. Disconnect from database
        await disconnectdb();
        logger.info("Database connection closed.");

        process.exit(0);
    } catch (error) {
        logger.error("Error during graceful shutdown:", error.message);
        process.exit(1);
    }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start the service
startWorker();

