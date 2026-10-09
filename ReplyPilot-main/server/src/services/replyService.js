import axios from 'axios';
import { env } from '../config/env.js';

const AI_SERVICE_URL = env.AI_SERVICE_URL || 'http://localhost:8000';

/**
 * Calls the FastAPI /generate endpoint to produce a single reply.
 *
 * @param {Object} params
 * @param {string} params.commentId    – MongoDB _id of the comment
 * @param {string} params.commentText  – The raw comment text
 * @param {string} params.tone         – e.g. 'friendly', 'professional'
 * @param {string} [params.personaId]  – optional Persona ObjectId
 * @param {string} [params.videoContext] – optional "title + description"
 * @returns {Promise<Object>}          – { comment_id, reply_text, tone, model_used, char_count }
 */
export const generateReply = async ({
  commentId,
  commentText,
  tone = 'friendly',
  personaId = null,
  videoContext = '',
  videoId = null,
  intents = [],
  isEnglish = true,
  creatorBio = null,
  fewShotExamples = null
}) => {
  try {
    const response = await axios.post(`${AI_SERVICE_URL}/api/v1/generate`, {
      comment_id: commentId,
      comment_text: commentText,
      tone,
      persona_id: personaId,
      video_context: videoContext,
      video_id: videoId,
      intents,
      is_english: isEnglish,
      creator_bio: creatorBio,
      few_shot_examples: fewShotExamples
    });
    return response.data;
  } catch (error) {
    console.error('Error calling AI generate service:', error.message);
    throw error;
  }
};

/**
 * Calls the FastAPI /generate_batch endpoint for multiple comments at once.
 *
 * @param {Array<Object>} items – array of { commentId, commentText, tone, personaId, videoContext, videoId, intents, isEnglish, creatorBio, fewShotExamples }
 * @returns {Promise<Array<Object>>}
 */
export const generateReplyBatch = async (items) => {
  try {
    const payload = items.map((item) => ({
      comment_id: item.commentId,
      comment_text: item.commentText,
      tone: item.tone || 'friendly',
      persona_id: item.personaId || null,
      video_context: item.videoContext || '',
      video_id: item.videoId || null,
      intents: item.intents || [],
      is_english: item.isEnglish !== undefined ? item.isEnglish : true,
      creator_bio: item.creatorBio || null,
      few_shot_examples: item.fewShotExamples || null
    }));

    const response = await axios.post(`${AI_SERVICE_URL}/api/v1/generate_batch`, payload);
    return response.data;
  } catch (error) {
    console.error('Error calling AI generate_batch service:', error.message);
    throw error;
  }
};
