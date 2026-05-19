"""
Extract training data from PostgreSQL.
Run this on the Optiplex (has DB access).

Usage:
    cd ml/
    DATABASE_URL=postgresql://manga:manga@localhost:5432/manga_db python extract_data.py

Output: ml/data.csv
"""
import csv
import os
from collections import Counter, defaultdict
from pathlib import Path

import psycopg2

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://manga:manga@localhost:5432/manga_db")
MIN_GENRE_COUNT = 10
OUTPUT = Path(__file__).parent / "data.csv"

# These are content-type tags already captured by inferred_type, or meaningless
_EXCLUDE = {"manhwa", "webtoon", "manga", "manhua", "others", "full color"}

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

cur.execute("""
    SELECT m.id, m.title, m.description,
           ARRAY_AGG(mg.genre ORDER BY mg.genre) AS genres
    FROM manga m
    JOIN manga_genre mg ON mg.manga_id = m.id
    WHERE m.description IS NOT NULL AND m.description != ''
    GROUP BY m.id, m.title, m.description
""")
rows = cur.fetchall()
cur.close()
conn.close()

# Count case-insensitively; track the most-seen spelling as canonical form
ci_counter: Counter = Counter()           # lower → total count
ci_spellings: dict = defaultdict(Counter) # lower → {spelling: count}

for _, _, _, genres in rows:
    for g in genres:
        g = g.strip()
        if not g or g.lower() in _EXCLUDE:
            continue
        ci_counter[g.lower()] += 1
        ci_spellings[g.lower()][g] += 1

# Canonical spelling = the most-seen original casing
canonical: dict[str, str] = {
    lower: spellings.most_common(1)[0][0]
    for lower, spellings in ci_spellings.items()
}

valid_lower = {lower for lower, n in ci_counter.items() if n >= MIN_GENRE_COUNT}

print(f"Manga with descriptions : {len(rows)}")
print(f"Genres >= {MIN_GENRE_COUNT} examples : {len(valid_lower)}")
print(f"\nAll genres (after dedup & exclusions):")
for lower, n in ci_counter.most_common():
    mark = "✓" if lower in valid_lower else "✗"
    print(f"  [{mark}] {n:5d}  {canonical[lower]}")

out_rows = []
for manga_id, title, description, genres in rows:
    seen: set[str] = set()
    clean: list[str] = []
    for g in genres:
        g = g.strip()
        if not g or g.lower() in _EXCLUDE:
            continue
        lower = g.lower()
        if lower not in valid_lower or lower in seen:
            continue
        seen.add(lower)
        clean.append(canonical[lower])
    if clean:
        out_rows.append({
            "manga_id": manga_id,
            "title": title or "",
            "description": description or "",
            "genres": "|".join(clean),
        })

print(f"\nTraining examples : {len(out_rows)}")

with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["manga_id", "title", "description", "genres"])
    writer.writeheader()
    writer.writerows(out_rows)

print(f"Saved → {OUTPUT}")
