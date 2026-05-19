"""
Manga genre tagger — inference only.
Loads the model trained by ml/train_tagger.py and predicts genres
for manga that have no or sparse genre data.

Set TAGGER_MODEL_DIR env var to override the default model path.
Set TAGGER_THRESHOLD (0–1) to adjust prediction confidence cutoff.
"""
import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_MODEL_DIR = Path(__file__).parent.parent / "ml" / "model"
_MODEL_DIR = Path(os.getenv("TAGGER_MODEL_DIR", str(_DEFAULT_MODEL_DIR)))
_THRESHOLD = float(os.getenv("TAGGER_THRESHOLD", "0.30"))

_embedder = None
_clf = None
_mlb = None
_ready = False


def load():
    """Load model from disk. Called once at app startup."""
    global _embedder, _clf, _mlb, _ready

    embedder_path   = _MODEL_DIR / "embedder"
    classifier_path = _MODEL_DIR / "classifier.joblib"

    if not embedder_path.exists() or not classifier_path.exists():
        log.warning("Tagger model not found at %s — auto-tagging disabled", _MODEL_DIR)
        return

    try:
        import joblib
        from sentence_transformers import SentenceTransformer

        _embedder = SentenceTransformer(str(embedder_path))
        bundle = joblib.load(classifier_path)
        _clf = bundle["clf"]
        _mlb = bundle["mlb"]
        _ready = True
        log.info("Tagger ready — %d genre classes", len(_mlb.classes_))
    except Exception:
        log.exception("Failed to load tagger model")


def is_ready() -> bool:
    return _ready


def predict(title: str, description: str, threshold: float = _THRESHOLD) -> list[str]:
    """
    Return predicted genre tags for a manga.
    Only tags with confidence >= threshold are included.
    Returns [] if the model is not loaded.
    """
    if not _ready:
        return []

    text = f"{title}. {description}".strip(". ")
    if not text:
        return []

    try:
        import numpy as np

        emb   = _embedder.encode([text], normalize_embeddings=True)
        proba = _clf.predict_proba(emb)[0]
        return [cls for cls, p in zip(_mlb.classes_, proba) if p >= threshold]
    except Exception:
        log.exception("Tagger predict failed")
        return []
