from datetime import datetime, timedelta, timezone

from backend.community.hiring_signal import build_prefilter_terms, group_message_windows, is_hiring_related
from backend.community.models import DiscordMessage


def _make_message(message_id: str, author: str, content: str, created_at: datetime) -> DiscordMessage:
    return DiscordMessage(
        message_id=message_id,
        author_id="123",
        author_name=author,
        content=content,
        attachments=[],
        embeds=[],
        created_at=created_at,
        channel_id="456",
        channel_name="hiring",
        guild_id="789",
        message_url=f"https://discord.com/channels/789/456/{message_id}",
    )


def test_build_prefilter_terms():
    terms = build_prefilter_terms("engineer", ["hiring", "role"])
    assert "engineer" in terms
    assert "hiring" in terms


def test_is_hiring_related():
    assert is_hiring_related("We are hiring a backend engineer", ["hiring"])
    assert not is_hiring_related("Hello world", ["hiring"])


def test_group_message_windows():
    now = datetime.now(timezone.utc)
    messages = [
        _make_message("1", "Alice", "Hiring a designer", now),
        _make_message("2", "Bob", "Reach out for details", now + timedelta(minutes=10)),
        _make_message("3", "Carol", "Another update", now + timedelta(minutes=60)),
    ]
    windows = group_message_windows(messages, window_minutes=30, max_messages=5)
    assert len(windows) == 2
    assert len(windows[0].messages) == 2
    assert len(windows[1].messages) == 1