import app from "./src/app.js";
import { connectdb, disconnectdb } from "./src/config/db.js";
import { env } from "./src/config/env.js";

import startSyncCronJob from "./src/jobs/syncComments.job.js";

let server;
let syncCronTask;

const MAX_RETRY_DELAY_MS = 60_000;   // cap at 60 seconds
const INITIAL_RETRY_DELAY_MS = 5_000; // start at 5 seconds

async function startServer() {
    let attempt = 0;

    while (true) {
        try {
            attempt++;
            await connectdb();

            syncCronTask = startSyncCronJob();
            app.on("error", (error) => {
                console.log("Error!!", error);
                throw error;
            });
            server = app.listen(process.env.PORT||env.PORT||3000, () => {
                console.log(
                    `Server running on port:${env.PORT}`
                );
            });
            return; // success — exit the retry loop

        } catch (error) {
            const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
            console.warn(
                `Failed to start server (attempt ${attempt}): ${error.message}. ` +
                `Retrying in ${delay / 1000}s...`
            );
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

startServer();

["SIGTERM", "SIGINT"].forEach((sig) =>
    process.on(sig, async () => {
        console.info(`Caught ${sig}, draining...`);

        if (syncCronTask) {
            syncCronTask.stop();
            console.info("Sync cron job stopped.");
        }

        // 2. Only after workers are shut down, disconnect the database
        try {
            await disconnectdb();
            console.info("Database disconnected.");
        } catch (err) {
            console.error("Error disconnecting database:", err);
        }

        // 3. Close the HTTP server (promisified so we can await it)
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        }).catch((err) => console.error("Error closing HTTP server:", err));

        process.exit(0);
    })
);