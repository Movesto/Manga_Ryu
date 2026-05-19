"""
Train the manga genre tagger.
Run this on the GPU machine after copying ml/data.csv there.

Usage:
    cd ml/
    pip install -r requirements.txt
    python train_tagger.py

Output:
    ml/model/classifier.joblib   — sklearn classifier + label binarizer
    ml/model/embedder/           — sentence-transformer model (for offline inference)

After training, copy the entire ml/model/ directory to the Optiplex.
"""
import csv
from pathlib import Path

import joblib
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.multiclass import OneVsRestClassifier
from sklearn.preprocessing import MultiLabelBinarizer

DATA      = Path(__file__).parent / "data.csv"
MODEL_DIR = Path(__file__).parent / "model"
MODEL_DIR.mkdir(exist_ok=True)

# ── Load data ─────────────────────────────────────────────────────────────────

texts, genre_lists = [], []
with open(DATA, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        text = f"{row['title']}. {row['description']}".strip()
        genres = [g.strip() for g in row["genres"].split("|") if g.strip()]
        if text and genres:
            texts.append(text)
            genre_lists.append(genres)

print(f"Loaded {len(texts)} training examples")
if len(texts) < 50:
    print("WARNING: very few examples — consider gathering more data before training")

# ── Generate embeddings ───────────────────────────────────────────────────────

print("Generating embeddings (GPU will be used if available)…")
embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
embeddings = embedder.encode(
    texts,
    batch_size=128,
    show_progress_bar=True,
    normalize_embeddings=True,
)
print(f"Embeddings shape: {embeddings.shape}")

# ── Binarize labels ───────────────────────────────────────────────────────────

mlb = MultiLabelBinarizer()
Y = mlb.fit_transform(genre_lists)
print(f"Classes ({len(mlb.classes_)}): {list(mlb.classes_)}")

# ── Train ─────────────────────────────────────────────────────────────────────

print("Training classifier…")
clf = OneVsRestClassifier(
    LogisticRegression(C=4.0, max_iter=1000, solver="lbfgs"),
    n_jobs=-1,
)
clf.fit(embeddings, Y)

# ── Evaluate ──────────────────────────────────────────────────────────────────

print("Evaluating (3-fold cross-validation)…")
scores = cross_val_score(clf, embeddings, Y, cv=3, scoring="f1_samples", n_jobs=-1)
print(f"F1 (samples avg): {scores.mean():.3f} ± {scores.std():.3f}")

# ── Save ──────────────────────────────────────────────────────────────────────

classifier_path = MODEL_DIR / "classifier.joblib"
joblib.dump({"clf": clf, "mlb": mlb}, classifier_path)
print(f"Saved classifier  → {classifier_path}")

embedder_path = MODEL_DIR / "embedder"
embedder.save(str(embedder_path))
print(f"Saved embedder    → {embedder_path}")

print("\nDone. Copy ml/model/ to the inference machine (Optiplex).")
