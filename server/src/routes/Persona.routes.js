import express from "express";
import authMiddleware from "../middleware/auth.middleware.js";
import {
  createPersona,
  listPersonas,
  getPersona,
  updatePersona,
  deletePersona,
  analyzePersona,
} from '../controllers/Persona.controller.js';

const router = express.Router();

router.route('/').post(authMiddleware, createPersona);
router.route('/').get(authMiddleware, listPersonas);
router.route('/analyze').post(authMiddleware, analyzePersona);  // must be before /:id
router.route('/:id').get(authMiddleware, getPersona);
router.route('/:id').put(authMiddleware, updatePersona);
router.route('/:id').delete(authMiddleware, deletePersona);

export default router;
