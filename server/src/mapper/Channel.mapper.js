export default function(channel,userId){
    const { snippet, statistics, brandingSettings, contentDetails } = channel;

    return {
        channelId:    channel.id,
        userId,
        title:        snippet.title,
        description:  snippet.description,
        customUrl:    snippet.customUrl ?? null,
        country:      snippet.country  ?? null,
        publishedAt:  new Date(snippet.publishedAt),
        thumbnail: {
        default: snippet.thumbnails?.default?.url,
        medium:  snippet.thumbnails?.medium?.url,
        high:    snippet.thumbnails?.high?.url,
        },
        subscriberCount:      Number(statistics.subscriberCount ?? 0),
        videoCount:           Number(statistics.videoCount ?? 0),
        viewCount:            Number(statistics.viewCount ?? 0),
        hiddenSubscriberCount: statistics.hiddenSubscriberCount ?? false,
        keywords:             brandingSettings?.channel?.keywords?.split(' ').filter(Boolean) ?? [],
        defaultLanguage:      snippet.defaultLanguage ?? null,

        _uploadsPlaylistId: contentDetails?.relatedPlaylists?.uploads,
        lastSyncedAt: new Date(),
    };
}