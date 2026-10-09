import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import { enqueueBatch, getBatchStatus } from "../controllers/batch.controller.js";

const router = express.Router();

router.route("/").post(authMiddleware,enqueueBatch);

router.route("/:jobId").get(authMiddleware,getBatchStatus);

export default router;