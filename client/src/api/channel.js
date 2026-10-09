import api from './axios';
const handleError = (error, source) => {
  const message = error.response?.data?.message || error.message || "An unknown error occurred";
  console.error(`Error in ${source}:`, message);
  throw new Error(message); 
};

export const getChannel = async (force = false) => {
  try {
    const response = await api.get('/api/channel', { 
      params: force ? { force: 'true' } : {} 
    });
    return response.data.data;
  } catch (error) {
    handleError(error, 'getChannel');
  }
};

export const getVideos = async (params = {}) => {
  try {
    const response = await api.get('/api/channel/videos', { params });
    return response.data;
  } catch (error) {
    handleError(error, 'getVideos');
  }
};

export const getVideo = async (videoId) => {
  try {
    const response = await api.get(`/api/channel/videos/${videoId}`);
    return response.data.data;
  } catch (error) {
    handleError(error, 'getVideo');
  }
};

export const getVideoComments = async (videoId, params = {}) => {
  try {
    const response = await api.get(`/api/channel/videos/${videoId}/comments`, { params });
    return response.data;
  } catch (error) {
    handleError(error, 'getVideoComments');
  }
};

export const syncVideoComments = async (videoId) => {
  try {
    const response = await api.post(`/api/channel/videos/${videoId}/comments/sync`);
    return response.data;
  } catch (error) {
    handleError(error, 'syncVideoComments');
  }
};