const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  const comments = await db.collection('comments').find({ replyCount: { $gt: 0 } }).toArray();
  console.log('replied comments count:', comments.length);
  const zComments = await db.collection('comments').find({ replyCount: { $in: [0, null] } }).toArray();
  console.log('unreplied comments count:', zComments.length);
  
  const replies = await db.collection('replies').find({ status: 'published' }).toArray();
  console.log('Published replies count:', replies.length);

  for (const reply of replies) {
     const comment = await db.collection('comments').findOne({ _id: reply.commentId });
     console.log(`Reply ID: ${reply._id}, Comment ID: ${reply.commentId}, ReplyCount on Comment: ${comment ? comment.replyCount : 'Not found'} (Credited: ${reply.replyCountCredited})`);
  }

  await mongoose.disconnect();
}
check().catch(console.error);
