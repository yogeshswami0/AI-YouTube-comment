import axios from 'axios';
async function test() {
  try {
    const listRes = await axios.get('http://localhost:5000/api/replies?videoId=03%20DR1%20Trees%20%7C%2022%205%202023%20TLE%20Eliminators%20Level%204%20by%20Gaurish%20Baliga');
    const replies = listRes.data.items;
    if (replies.length > 0) {
       const id = replies[0]._id;
       console.log('Got reply ID:', id);
       try {
         await axios.post(`http://localhost:5000/api/replies/${id}/regenerate`);
         console.log('Regen success');
       } catch (err) {
         console.log('Regen error:', err.response?.data);
       }
       try {
         await axios.put(`http://localhost:5000/api/replies/${id}/edit`, { editedText: 'test' });
         console.log('Edit success');
       } catch (err) {
         console.log('Edit error:', err.response?.data);
       }
    } else {
       console.log('No reply found');
    }
  } catch (e) {
    console.error(e.message);
  }
}
test();
