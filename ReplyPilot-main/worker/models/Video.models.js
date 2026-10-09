import mongoose from "mongoose";

const VideoSchema=new mongoose.Schema(
    {
        videoId:{
            type:String,
            required:true,
            unique:true,
            index:true
        },
        channelId:{
            type:String,
            required:true,
        },
        userId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'User',
            required:true,
        },

        title:{type:String},
        description:{type:String},
        publishedAt:{type:Date},
        tags:[{type:String}],
        categoryId:{type:String},
        defaultLanguage:{type:String},
        liveBroadCastContent:{type:String},
        thumbnail:{
            default:String,
            medium:String,
            high:String,
            maxres:String,
        },
        viewCount:{type:Number,default:0},
        likeCount:{type:Number,default:0},
        commentCount:{type:Number,default:0},
        favoriteCount:{type:Number,default:0},

        duration:{type:String},
        definition:{type:String},
        caption:{type:String},

        commentsDisabled:{type:Boolean,default:false},
        lastSyncedAt:{type:Date,default:Date.now},
    },
    {timestamps:true},
);

VideoSchema.index({channelId:1,publishedAt:-1});

export default mongoose.model('Video',VideoSchema);
