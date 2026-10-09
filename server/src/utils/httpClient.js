import axios from "axios";
import { env } from "../config/env.js";
import logger from "./logger.js";

const httpClient = axios.create({
    baseURL:env.AI_SERVICE_URL,
    timeout:30_000,
    headers:{'Content-Type':'application/json'},
});

httpClient.interceptors.response.use(
    (res)=>res,
    (err)=>{
        logger.error('ai-service request failed:',{
            url:err.config?.url,
            status:err.response?.status,
            data:err.response?.data,
        });
        return Promise.reject(err);
    }
);

export default httpClient;