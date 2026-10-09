export default function (item, videoId, channelId, isReply, parentId) {
  const s = item.snippet;
  return {
    ytCommentId:     item.id,
    videoId,
    channelId:       channelId ?? '',
    text:            s.textOriginal   ?? s.textDisplay,
    textDisplay:     s.textDisplay,
    authorName:      s.authorDisplayName,
    authorChannelId: s.authorChannelId?.value ?? null,
    authorAvatar:    s.authorProfileImageUrl  ?? null,
    likeCount:       Number(s.likeCount  ?? 0),
    replyCount:      Number(s.totalReplyCount ?? 0),
    publishedAt:     new Date(s.publishedAt),
    isReply,
    parentId,
  };
}