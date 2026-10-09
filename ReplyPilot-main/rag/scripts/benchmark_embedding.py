"""
scripts/benchmark_embedding.py — compare BGE model variants for speed and output.

Usage:
    python scripts/benchmark_embedding.py

Benchmarks all three BGE variants on a fixed set of texts and reports:
  - Model load time
  - Encoding speed (texts/second)
  - Vector dimension
  - Memory usage (approximate)
"""

import sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

MODELS = [
    "BAAI/bge-base-en-v1.5",
    "BAAI/bge-large-en-v1.5",
    "BAAI/bge-m3",
]

SAMPLE_TEXTS = [
    "The attention mechanism allows the model to focus on relevant parts of the input.",
    "Backpropagation computes gradients of the loss function with respect to model weights.",
    "Convolutional neural networks are powerful for image recognition tasks.",
    "Transformers revolutionised natural language processing when introduced in 2017.",
    "Positional encodings give the transformer model awareness of token sequence order.",
    "BERT uses bidirectional attention while GPT uses unidirectional causal attention.",
    "The learning rate is a hyperparameter that controls the step size during training.",
    "Dropout is a regularisation technique that randomly zeroes activations during training.",
]


def benchmark_model(model_name: str) -> dict:
    from sentence_transformers import SentenceTransformer

    print(f"\nLoading {model_name} ...")
    t0 = time.time()
    model = SentenceTransformer(model_name, device="cpu")
    load_time = time.time() - t0

    # Warm-up
    model.encode(["warm up"], normalize_embeddings=True)

    # Benchmark: encode 10 batches
    runs = 5
    t0 = time.time()
    for _ in range(runs):
        vecs = model.encode(SAMPLE_TEXTS, normalize_embeddings=True, batch_size=8)
    elapsed = time.time() - t0

    texts_per_second = (len(SAMPLE_TEXTS) * runs) / elapsed
    dim = vecs.shape[1]

    return {
        "model": model_name,
        "dimension": dim,
        "load_time_s": round(load_time, 2),
        "texts_per_second": round(texts_per_second, 1),
        "total_time_s": round(elapsed, 2),
    }


def main() -> None:
    print("BGE Embedding Model Benchmark")
    print("=" * 60)
    print(f"Sample texts: {len(SAMPLE_TEXTS)}")
    print("Device: CPU")

    results = []
    for model_name in MODELS:
        try:
            result = benchmark_model(model_name)
            results.append(result)
            print(f"\n{result['model']}")
            print(f"  Dimension       : {result['dimension']}")
            print(f"  Load time       : {result['load_time_s']}s")
            print(f"  Texts/second    : {result['texts_per_second']}")
        except Exception as e:
            print(f"\nFailed to benchmark {model_name}: {e}")

    print("\n" + "=" * 60)
    print("RECOMMENDATION:")
    if results:
        fastest = max(results, key=lambda r: r["texts_per_second"])
        print(f"  Fastest: {fastest['model']} ({fastest['texts_per_second']} texts/s)")
        print(f"  Set BGE_MODEL_NAME={fastest['model']} in .env for CPU deployments.")
        print(f"  Set PINECONE_DIMENSION={fastest['dimension']}")


if __name__ == "__main__":
    main()
