import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { regenerateReply } from './src/controllers/reply.controller.js';
import Reply from './src/models/Reply.models.js';

async function test() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ReplyPilot';
    await mongoose.connect(mongoUri);

    const reply = await Reply.findOne();
    if (!reply) {
      console.log('No reply in DB');
      process.exit(0);
    }

    const req = {
      params: { replyId: reply._id.toString() },
      body: {}
    };

    const res = {
      status: (c) => { console.log('STATUS:', c); return res; },
      json: (d) => { console.log('JSON:', d); return res; }
    };

    const next = (err) => {
      console.log('NEXT CALLED WITH ERRROR:');
      console.log(err.stack || err);
    };

    console.log('Calling regenerateReply...');
    await regenerateReply(req, res, next);
    
    process.exit(0);
  } catch (err) {
    console.error('CRASH IN TEST SCRIPT:');
    console.error(err.stack || err);
    process.exit(1);
  }
}

test();
