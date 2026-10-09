import asyncio
import os
import json
from dotenv import load_dotenv

# load environment variables
load_dotenv()

from pinecone import Pinecone
from app.services.query_service import QueryService

async def main():
    # 1. Provide Details
    video_id = "eBC3iGbzbn4"
    print(f"--- Details ---")
    print(f"Video ID: {video_id}")
    
    # 2. Check Pinecone chunk counts
    pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
    index_name = os.environ.get("PINECONE_INDEX_NAME")
    index = pc.Index(index_name)
    
    # In pinecone, the easiest way to count chunks for a video_id is to fetch by prefix if namespace or metadata.
    # We can query with a dummy vector and filter by video_id to get up to 10k results
    dummy_vec = [0.0] * 1024
    stats = index.query(
        vector=dummy_vec,
        filter={"video_id": video_id},
        top_k=10000,
        include_metadata=False
    )
    chunk_count = len(stats.matches)
    print(f"Number of chunks stored in Pinecone for video {video_id}: {chunk_count}")
    
    # 3. Retrieve chunks for the question
    question = "what is the girl telling about herself?"
    print(f"\n--- Relevant Chunks Extraction ---")
    print(f"Question: {question}")
    
    print(f"\n--- Pinecone Fetch ---")
    stats = index.query(
        vector=dummy_vec,
        filter={"video_id": video_id},
        top_k=2,
        include_metadata=True
    )
    for match in stats.matches:
        print(match.metadata)

if __name__ == "__main__":
    asyncio.run(main())
