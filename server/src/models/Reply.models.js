import mongoose from "mongoose";

const ReplySchema=new mongoose.Schema(
    {
        commentId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'Comment',
            unique:true,
            required:true,
            index:true,
        },
        ytCommentId:{
            type:String,
            required:true,
        },
        personaId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'Persona',
        },
        generatedText:{type:String,trim:true},
        editedText:{type:String,trim:true},
        finalText:{type:String,trim:true},  //if not changed then it is same as generated text else editedtext
        tone:{
            type:String,
            enum:[
                    'friendly',
                    'professional',
                    'humorous',
                    'promotional',
                    'appreciative',
                    'informative',
                    'supportive',
                    'apologetic',
                    'neutral',
                    'romantic',
                    'rude',
                    'crazy'
                    ],
            default:'friendly'
        },
        status:{
            type:String,
            enum:['pending_review','approved','rejected','publishing','published','failed'],
            default:'pending_review',
        },
        publishedAt:{type:Date},
        ytReplyId:{type:String,unique:true, sparse:true},
    },
    {timestamps:true}
);

ReplySchema.pre("save", function() {
    if(!this.finalText){
        this.finalText=this.editedText || this.generatedText;
    }
});

ReplySchema.index({status:1,createdAt:-1});

export default mongoose.model('Reply',ReplySchema);