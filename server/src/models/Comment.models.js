import mongoose from "mongoose";

const IntentScoreSchema = new mongoose.Schema(
    {
        label: {
            type: String,
            enum: ['question', 'praise', 'criticism', 'spam', 'neutral'],
            required: true,
        },
        confidence: {
            type: Number,
            required: true,
            min: 0,
            max: 1,
        },
    },
    { _id: false }
);

const CommentSchema=new mongoose.Schema(
    {
        ytCommentId:{
            type:String,
            required:true,
            unique:true,
            index:true,
        },
        videoId:{
            type:String,
            required:true,
            index:true,
        },
        channelId:{
            type:String,
            required:true,
        },

        text:{type:String,required:true},
        textDisplay:{type:String},
        authorName:{type:String},
        authorChannelId:{type:String},
        authorAvatar:{type:String},
        likeCount:{type:Number,default:0},
        replyCount:{type:Number,default:0},
        publishedAt:{type:Date},
        updatedAt:{type:Date},
        isReply:{type:Boolean,default:false}, //true if it's a reply to another's comment
        parentId:{type:String,default:null}, //parent ytcommentId if it's a reply to another's comment 

        intents:{
            type:[IntentScoreSchema],
            default:[],
        },
        isSpam:{type:Boolean,default:false},

        classificationStatus:{
            type:String,
            enum:['pending','processing','done','failed'],
            default:'pending',
            index:true
        },
        language:{type:String,default:null},
        isEnglish:{type:Boolean,default:true}
    },
    {timestamps:true}
);

CommentSchema.index({videoId:1,publishedAt:-1});
CommentSchema.index({videoId:1,'intents.label':1});

export default mongoose.model('Comment',CommentSchema);