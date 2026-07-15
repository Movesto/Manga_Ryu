import os
import sys
from pathlib import Path

# Make the backend modules importable when running `pytest` from backend/
sys.path.insert(0, str(Path(__file__).parent.parent))

# auth.py requires JWT_SECRET at import time
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
