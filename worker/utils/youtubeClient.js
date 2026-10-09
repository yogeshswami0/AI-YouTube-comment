import { google } from "googleapis";
import { env } from "../config/env.js";
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import logger from './logger.js';

export function buildYoutubeClient(accessToken){
    logger.debug('Building authenticated YouTube client');
    const auth=new google.auth.OAuth2(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
    );

    auth.setCredentials({access_token:accessToken});

    return google.youtube({version:'v3',auth});
}

export function buildPublicYoutubeClient(){
    return google.youtube({version:'v3',auth:env.YOUTUBE_API_KEY});
}

/**
 * Fetches the latest videos for a specific channel published after the given date.
 */
export async function fetchLatestVideos(youtubeClient, channelId, publishedAfter) {
    const logMsg = publishedAfter 
        ? `Fetching latest videos for channel ${channelId} published after ${publishedAfter.toISOString()}`
        : `Fetching latest videos for channel ${channelId} (no date limit)`;
    logger.debug(logMsg);
    
    try {
        const params = {
            part: 'snippet',
            channelId: channelId,
            maxResults: 50,
            order: 'date',
            type: 'video'
        };
        if (publishedAfter) {
            params.publishedAfter = publishedAfter.toISOString();
        }

        const response = await youtubeClient.search.list(params);
        
        const itemsCount = response.data.items ? response.data.items.length : 0;
        logger.debug(`Successfully fetched ${itemsCount} videos for channel ${channelId}`);
        return response.data.items || [];
    } catch (error) {
        logger.error(`Error fetching latest videos for channel ${channelId}: ${error.message}`, { errorStack: error.stack });
        throw error;
    }
}

/**
 * Fetches the transcript for a given video ID and returns it as a continuous string.
 * Prioritizes English ('en') if available.
 */
export async function fetchTranscript(videoId) {
    logger.debug(`Fetching transcript for video ${videoId}`);
    try {
        // Try fetching English transcript first
        let transcriptItems;
        try {
            logger.debug(`Attempting to fetch English transcript for ${videoId}`);
            transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        } catch (enError) {
            logger.warn(`English transcript not available for ${videoId}: ${enError.message}. Falling back to default.`);
            // Fallback to default (original video language)
            transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
        }

        const transcriptJson = JSON.stringify(transcriptItems.map(item => ({
            text: item.text,
            start: item.offset/1000,
            duration: item.duration/1000
        })));
        logger.debug(`Successfully fetched transcript for video ${videoId} (length: ${transcriptJson.length})`);
        return transcriptJson;
    } catch (error) {
        logger.warn(`Could not fetch any transcript for video ${videoId}: ${error.message}`);
        // Not throwing error because some videos legitimately don't have transcripts, just return null
        return null;
    }
}
