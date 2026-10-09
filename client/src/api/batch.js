import api from './axios';

const handleBatchError = (error, action) => {
  const message = error.response?.data?.message || error.message || "Failed to process batch action";
  console.error(`[Batch Service] Error during ${action}:`, message);
  throw error;
};

/**
 * Enqueue comments for batch processing (classify → auto-generate).
 * @param {Object} payload
 * @param {string} payload.videoId       – Required
 * @param {string[]} [payload.commentIds] – Specific IDs, or omit for all pending
 * @param {string} [payload.tone]        – Reply tone (default: friendly)
 * @param {string} [payload.personaId]   – Optional persona ID
 */
export const enqueueBatch = async ({ videoId, commentIds, tone, personaId }) => {
  try {
    const body = { videoId };
    if (commentIds?.length) body.commentIds = commentIds;
    if (tone) body.tone = tone;
    if (personaId) body.personaId = personaId;

    const response = await api.post('/api/batch', body);
    return response.data;
  } catch (error) {
    handleBatchError(error, 'enqueueBatch');
  }
};

/**
 * Get the status of a specific batch job.
 */
export const getBatchJobStatus = async (jobId) => {
  try {
    const response = await api.get(`/api/batch/${jobId}`);
    return response.data;
  } catch (error) {
    handleBatchError(error, 'getBatchJobStatus');
  }
};
