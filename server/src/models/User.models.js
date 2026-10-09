import mongoose from "mongoose";

const UserSchema=new mongoose.Schema(
    {
        googleId:{
            type:String,
            required:true,
            unique:true,
            index:true
        },
        email:{
            type:String,
            required:true,
            unique:true
        },
        displayName:{type:String},
        avatar:{type:String},
        refreshToken:{type:String, select:false},
        channelId:{type:String,default:null}
    },
    {timestamps:true}
);

UserSchema.methods.toJSON=function (){
    const obj=this.toObject();
    delete obj.refreshToken;
    return obj;
}
export default mongoose.model('User',UserSchema);