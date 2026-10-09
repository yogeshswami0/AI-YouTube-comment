import api from './axios'


const handleApiError = (error, operation) => {
  const errorMessage = error.response?.data?.message || error.message || "Server Error";
  console.error(`[API Error] ${operation}:`, errorMessage);
  throw error; 
};

export const listComments = async (params = {}) => {
  try {
    const response = await api.get('/api/comments', { params });
    return response.data;
  } catch (error) {
    handleApiError(error, 'listComments');
  }
};

export const getComment = async (id) => {
  try {
    const response = await api.get(`/api/comments/${id}`);
    return response.data.data;
  } catch (error) {
    handleApiError(error, 'getComment');
  }
};

export const updateCommentIntent = async (id, intent) => {
  try {
    const response = await api.patch(`/api/comments/${id}/intent`, { intent });
    return response.data;
  } catch (error) {
    handleApiError(error, 'updateCommentIntent');
  }
};

export const classifyComment = async (id) => {
  try {
    const response = await api.post(`/api/comments/${id}/classify`);
    return response.data;
  } catch (error) {
    handleApiError(error, 'classifyComment');
  }
};

export const searchAll = async (q) => {
  try {
    const response = await api.get('/api/comments/search', { params: { q } });
    return response.data;
  } catch (error) {
    handleApiError(error, 'searchAll');
  }
};