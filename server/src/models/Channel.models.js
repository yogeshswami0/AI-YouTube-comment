import mongoose from "mongoose";

const ChannelSchema = new mongoose.Schema(
    {

        channelId: {
            type: String,
            unique: true,
            required: true,
            index: true,
        },

        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },

        title: { type: String },  //channel name
        description: { type: String },
        customUrl: { type: String }, //url handle
        country: { type: String },
        publishedAt: { type: Date },

        thumbnail: {
            default: { type: String },
            medium: { type: String },
            high: { type: String },
        },

        subscriberCount: { type: Number, default: 0 },
        videoCount: { type: Number, default: 0 },
        viewCount: { type: Number, default: 0 },
        hiddenSubscriberCount: { type: Boolean, default: false },

        keywords: [{ type: String }],
        defaultLanguage: { type: String },

        _uploadsPlaylistId: { type: String },

        lastSyncedAt: {
            type: Date,
            default: Date.now
        },
    },

    { timestamps: true }
);

export default mongoose.model('Channel', ChannelSchema);