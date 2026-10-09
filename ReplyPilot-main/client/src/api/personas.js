import api from './axios';


const handlePersonaError = (error, action) => {
  const message = error.response?.data?.error || error.response?.data?.message || error.message || "Failed to process persona request";
  console.error(`[Persona Service] Error during ${action}:`, message);
  throw new Error(message);
};

export const listPersonas = async () => {
  try {
    const response = await api.get('/api/personas');
    return response.data.data;
  } catch (error) {
    handlePersonaError(error, 'listPersonas');
  }
};

export const getPersona = async (id) => {
  try {
    const response = await api.get(`/api/personas/${id}`);
    return response.data.data;
  } catch (error) {
    handlePersonaError(error, 'getPersona');
  }
};

export const createPersona = async (data) => {
  try {
    const response = await api.post('/api/personas', data);
    return response.data.data;
  } catch (error) {
    handlePersonaError(error, 'createPersona');
  }
};

export const updatePersona = async (id, data) => {
  try {
    const response = await api.put(`/api/personas/${id}`, data);
    return response.data.data;
  } catch (error) {
    handlePersonaError(error, 'updatePersona');
  }
};

export const deletePersona = async (id) => {
  try {
    const response = await api.delete(`/api/personas/${id}`);
    return response.data;
  } catch (error) {
    handlePersonaError(error, 'deletePersona');
  }
};

/**
 * Sends a bio to the AI to extract personality traits/tone
 */
export const analyzePersona = async (bio) => {
  try {
    const response = await api.post('/api/personas/analyze', { bio });
    return response.data.data;
  } catch (error) {
    handlePersonaError(error, 'analyzePersona');
  }
};