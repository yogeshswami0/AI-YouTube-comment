import axios from 'axios';
<<<<<<< HEAD

const AI_SERVICE_URL = 'http://localhost:8000'; // Your FastAPI address

export const classifyIntent = async (commentText, commentId = "unknown_id") => {
  try {
    const response = await axios.post(`${AI_SERVICE_URL}/classify`, {
=======
import { env } from '../config/env.js';


export const classifyIntent = async (commentText, commentId = "unknown_id") => {
  try {
    const response = await axios.post(`${env.AI_SERVICE_URL}/classify`, {
>>>>>>> 39d2e71ec2858adad274a493b3d4635e4c1ee28a
      comment_id: commentId,
      text: commentText
    });
    return response.data; // Should return { "intent": "QUESTION", ... }
  } catch (error) {
    console.error("Error calling AI Service:", error);
    throw error;
  }
};