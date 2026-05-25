from app.analyze.source_reputation import lookup


def test_known_high_source() -> None:
    label, weight = lookup("xinhua")
    assert label == "high"
    assert weight >= 0.8


def test_known_medium_source() -> None:
    label, weight = lookup("zhihu_hot")
    assert label == "medium"
    assert 0.5 <= weight < 0.8


def test_known_low_source() -> None:
    label, weight = lookup("baidu_hot")
    assert label == "low"
    assert weight < 0.5


def test_unknown_source_neutral() -> None:
    label, weight = lookup("never_heard_of_it")
    assert label == "unknown"
    assert weight == 0.5
