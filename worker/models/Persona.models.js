import mongoose from "mongoose";

const PersonaSchema=new mongoose.Schema(
    {
        userId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'User',
            required:true,
        },
        name:{
            type:String,
            required:true,
        },
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
        creatorBio:{type:String},
        vocabulary:[{type:String}],
        examples:[
            {
                commentText:{type:String},
                replyText:{type:String},
            }
        ],
        icon:{type:String, default:'🎭'},
        isDefault:{
            type:Boolean,
            default:false
        }
    },
    {timestamps:true}
);

export default mongoose.model('Persona',PersonaSchema);
