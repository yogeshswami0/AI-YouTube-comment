"""
scripts/seed_redis.py — push a sample transcript into Redis for dev/testing.

Usage:
    python scripts/seed_redis.py
    python scripts/seed_redis.py --video-id my_id --overwrite
    python scripts/seed_redis.py --file tests/fixtures/sample_transcript.json --video-id abc
"""

import argparse, json, sys
from pathlib import Path
import redis

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.core.config import get_settings

settings = get_settings()

SAMPLE = [
    {"text": "Hello and welcome to this tutorial", "start": 0.0, "duration": 2.5},
    {"text": "today we are covering RAG systems", "start": 2.5, "duration": 3.0},
    {"text": "RAG stands for Retrieval Augmented Generation", "start": 5.5, "duration": 3.5},
    {"text": "first we retrieve relevant documents from a vector database", "start": 9.0, "duration": 3.5},
    {"text": "then we pass them as context to a large language model", "start": 12.5, "duration": 3.5},
    {"text": "the LLM uses the context to generate accurate answers", "start": 16.0, "duration": 3.5},
    {"text": "embeddings are vectors that represent semantic meaning", "start": 19.5, "duration": 3.5},
    {"text": "similar sentences have vectors that are close in vector space", "start": 23.0, "duration": 3.5},
    {"text": "cosine similarity measures the angle between two vectors", "start": 26.5, "duration": 3.5},
    {"text": "Pinecone stores and indexes these vectors efficiently", "start": 30.0, "duration": 3.5},
    {"text": "BGE is a powerful open source embedding model from BAAI", "start": 33.5, "duration": 3.5},
    {"text": "time-based chunking works well for YouTube transcripts", "start": 37.0, "duration": 3.5},
    {"text": "each chunk represents a fixed time window of the video", "start": 40.5, "duration": 3.5},
    {"text": "thank you for watching this overview", "start": 44.0, "duration": 3.0},
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video-id", default="sample_video_001")
    parser.add_argument("--file", default=None)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    if args.file:
        path = Path(args.file)
        if not path.exists():
            print(f"ERROR: File not found: {path}"); sys.exit(1)
        transcript = json.loads(path.read_text())
        print(f"Loaded {len(transcript)} segments from {path}")
    else:
        transcript = SAMPLE
        print(f"Using built-in sample transcript ({len(transcript)} segments)")

    client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        client.ping()
    except Exception as e:
        print(f"ERROR: Cannot connect to Redis: {e}"); sys.exit(1)

    key = f"{settings.REDIS_TRANSCRIPT_PREFIX}{args.video_id}"

    if client.exists(key) and not args.overwrite:
        print(f"Key already exists: {key}\nUse --overwrite to replace it.")
        client.close(); return

    client.set(key, json.dumps(transcript))
    duration = transcript[-1]["start"] + transcript[-1]["duration"]
    print(f"\nSeeded: {key}")
    print(f"  Segments : {len(transcript)}")
    print(f"  Duration : ~{duration:.1f}s")
    print(f"\nTrigger ingest:")
    print(f'  curl -X POST http://localhost:8000/api/v1/ingest -H "Content-Type: application/json" -d \'{{"video_id": "{args.video_id}", "chunk_window_seconds": 30}}\'')
    client.close()


if __name__ == "__main__":
    main()
