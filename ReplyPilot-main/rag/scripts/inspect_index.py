"""
scripts/inspect_index.py — query Pinecone and pretty-print results for debugging.

Usage:
    python scripts/inspect_index.py --question "what is attention mechanism"
    python scripts/inspect_index.py --question "backpropagation" --video-id dQw4w9WgXcQ --top-k 5
"""

import argparse, sys, asyncio
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.core.config import get_settings
from app.services.query_service import QueryService

settings = get_settings()


async def run(question: str, video_id: str | None, top_k: int, threshold: float) -> None:
    service = QueryService()
    results = await service.search(
        question=question,
        video_id=video_id,
        top_k=top_k,
        score_threshold=threshold,
    )

    print(f"\nQuery    : {question}")
    print(f"Video ID : {video_id or 'global'}")
    print(f"Results  : {len(results)}")
    print("=" * 70)

    if not results:
        print("No results above threshold.")
        return

    for i, r in enumerate(results, 1):
        meta = r.get("metadata", {})
        print(f"\n[{i}] chunk_id={r['chunk_id']}  score={r['score']:.4f}")
        print(f"    Time: {meta.get('start_time_seconds', '?')}s — {meta.get('end_time_seconds', '?')}s")
        print(f"    Video: {meta.get('video_title', 'N/A')}")
        print(f"    Text: {r['text'][:200]}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--question", required=True)
    parser.add_argument("--video-id", default=None)
    parser.add_argument("--top-k", type=int, default=4)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()

    asyncio.run(run(args.question, args.video_id, args.top_k, args.threshold))


if __name__ == "__main__":
    main()
