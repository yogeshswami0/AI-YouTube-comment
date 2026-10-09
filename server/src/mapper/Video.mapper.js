export default function (item, channelId, userId) {
  const { snippet, statistics, contentDetails, status } = item;
  return {
    videoId:    item.id,
    channelId,
    userId,
    title:      snippet.title,
    description:snippet.description,
    publishedAt:new Date(snippet.publishedAt),
    tags:       snippet.tags ?? [],
    categoryId: snippet.categoryId,
    defaultLanguage:      snippet.defaultLanguage ?? null,
    liveBroadcastContent: snippet.liveBroadcastContent,
    thumbnail: {
      default: snippet.thumbnails?.default?.url,
      medium:  snippet.thumbnails?.medium?.url,
      high:    snippet.thumbnails?.high?.url,
      maxres:  snippet.thumbnails?.maxres?.url,
    },
    viewCount:    Number(statistics?.viewCount     ?? 0),
    likeCount:    Number(statistics?.likeCount     ?? 0),
    commentCount: Number(statistics?.commentCount  ?? 0),
    favoriteCount:Number(statistics?.favoriteCount ?? 0),
    duration:     contentDetails?.duration ?? null,
    definition:   contentDetails?.definition ?? null,
    caption:      contentDetails?.caption ?? null,
    commentsDisabled: status?.madeForKids ?? false,
    lastSyncedAt: new Date(),
  };
}