from sync import _infer_type


def test_manhua_source():
    assert _infer_type("Top Manhua", []) == "manhua"


def test_manhua_genre_wins_over_unknown_source():
    assert _infer_type("Some Source", ["Manhua"]) == "manhua"


def test_webtoon_source():
    assert _infer_type("Webtoon XYZ", []) == "webtoon"


def test_manhwa_source():
    assert _infer_type("Asura Scans", []) == "manhwa"


def test_japanese_aggregator_is_manga():
    assert _infer_type("MangaDex", []) == "manga"


def test_unknown_defaults_to_manhwa():
    assert _infer_type("Unknown Source", []) == "manhwa"
