import mongoose from "mongoose";

const PersonaExampleSchema = new mongoose.Schema(
    {
        personaId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:'Persona',
            required:true,
            index:true,
        },
        scores: {
            question: {type:Number,default:0,min:0,max:1},
            praise: {type:Number,default:0,min:0,max:1},
            critism: {type:Number,default:0,min:0,max:1},
            neutral: {type:Number,default:0,min:0,max:1},
            spam: {type:Number,default:0,min:0,max:1},
        },
        commentText:{type:String,required:true},
        replyText:{type:String,required:true},
    },
    {timestamps:true},
);

export default mongoose.model("PersonaExample",PersonaExampleSchema);
