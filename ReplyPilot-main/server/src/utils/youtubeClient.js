import { google } from "googleapis";
import { env } from "../config/env.js";


export function buildYoutubeClient(accessToken){
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