from __future__ import annotations

import json
import re
import sqlite3
from html import unescape
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


DB_PATH = Path(__file__).with_name("assistant_web.sqlite3")
TZ = ZoneInfo("Asia/Kolkata")
PERMISSIONS = {
    "calendar": False,
    "web": False,
    "llm": False,
    "quotes": False,
}
DEFAULT_DAILY_PLAN = """7:00 AM
8:00 AM
9:00 AM
11:00 AM
1:00 PM
3:00 PM
5:00 PM
7:00 PM
9:00 PM"""
DEFAULT_WEEKLY_PLAN = """Monday
- 

Tuesday
- 

Wednesday
- 

Thursday
- 

Friday
- 

Saturday
- 

Sunday
- """
QUOTE_BANK = [
    ("Small steady work still changes the day.", "local studio note"),
    ("A routine is softer when it makes room for real life.", "local studio note"),
    ("The best reset is usually the next honest action.", "local studio note"),
    ("Momentum grows faster when the pressure drops.", "local studio note"),
    ("Quiet structure can carry more than loud motivation.", "local studio note"),
    ("A softer pace still counts as progress.", "local studio note"),
]


def db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def now_local() -> datetime:
    return datetime.now(TZ).replace(microsecond=0)


def now_iso() -> str:
    return now_local().isoformat()


def today_key() -> str:
    return now_local().date().isoformat()


def init_db() -> None:
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS routines (
                kind TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                remind_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS checkins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                time_of_day TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                last_completed_on TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS quote_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quote_text TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sticky_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT 'wine',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        connection.execute(
            """
            INSERT INTO settings(key, value)
            VALUES('water', '{"intervalMinutes": 120, "paused": false}')
            ON CONFLICT(key) DO NOTHING
            """
        )
        connection.execute(
            """
            INSERT INTO routines(kind, content, updated_at)
            VALUES('daily', ?, ?)
            ON CONFLICT(kind) DO NOTHING
            """,
            (DEFAULT_DAILY_PLAN, now_iso()),
        )
        connection.execute(
            """
            INSERT INTO routines(kind, content, updated_at)
            VALUES('weekly', ?, ?)
            ON CONFLICT(kind) DO NOTHING
            """,
            (DEFAULT_WEEKLY_PLAN, now_iso()),
        )


def parse_local_datetime(raw: str) -> datetime:
    cleaned = raw.strip()
    parsed = datetime.fromisoformat(cleaned)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TZ)
    return parsed.astimezone(TZ)


def list_routines() -> dict[str, dict]:
    with db() as connection:
        rows = connection.execute("SELECT * FROM routines").fetchall()
    result = {row["kind"]: dict(row) for row in rows}
    if "daily" not in result:
        result["daily"] = {"kind": "daily", "content": DEFAULT_DAILY_PLAN, "updated_at": now_iso()}
    if "weekly" not in result:
        result["weekly"] = {"kind": "weekly", "content": DEFAULT_WEEKLY_PLAN, "updated_at": now_iso()}
    return result


def save_routine(kind: str, content: str) -> None:
    with db() as connection:
        connection.execute(
            """
            INSERT INTO routines(kind, content, updated_at)
            VALUES(?, ?, ?)
            ON CONFLICT(kind) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
            """,
            (kind, content, now_iso()),
        )


def get_water_settings() -> dict:
    with db() as connection:
        row = connection.execute("SELECT value FROM settings WHERE key = 'water'").fetchone()
    return json.loads(row["value"])


def save_water_settings(payload: dict) -> None:
    with db() as connection:
        connection.execute(
            """
            INSERT INTO settings(key, value)
            VALUES('water', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (json.dumps(payload),),
        )


def list_reminders() -> list[dict]:
    with db() as connection:
        rows = connection.execute(
            "SELECT * FROM reminders WHERE status != 'deleted' ORDER BY remind_at ASC"
        ).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        local = parse_local_datetime(item["remind_at"])
        item["displayTime"] = local.strftime("%d %b %Y, %I:%M %p IST")
        item["dayKey"] = local.date().isoformat()
        items.append(item)
    return items


def list_checkins() -> list[dict]:
    with db() as connection:
        rows = connection.execute("SELECT * FROM checkins ORDER BY time_of_day ASC, id ASC").fetchall()
    items = []
    today = today_key()
    for row in rows:
        item = dict(row)
        item["isDoneToday"] = item["last_completed_on"] == today
        items.append(item)
    return items


def list_notes() -> list[dict]:
    with db() as connection:
        rows = connection.execute("SELECT * FROM sticky_notes ORDER BY id DESC").fetchall()
    return [dict(row) for row in rows]


def list_projects() -> list[dict]:
    with db() as connection:
        rows = connection.execute("SELECT * FROM projects ORDER BY status ASC, id DESC").fetchall()
    return [dict(row) for row in rows]


def recent_quotes(limit: int = 30) -> list[dict]:
    with db() as connection:
        rows = connection.execute(
            "SELECT id, quote_text, source, created_at FROM quote_history ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def current_quote() -> dict:
    history = recent_quotes(limit=1)
    latest = history[0] if history else rotate_quote()
    return {"text": latest["quote_text"], "source": latest["source"], "updatedAt": latest["created_at"]}


def fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": "personal-assistant-local-app"})
    with urlopen(request, timeout=12) as response:
        return json.loads(response.read().decode())


def fetch_text(url: str) -> str:
    request = Request(url, headers={"User-Agent": "personal-assistant-local-app"})
    with urlopen(request, timeout=15) as response:
        return response.read().decode(errors="ignore")


def strip_html(raw: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def rotate_quote(force: bool = False) -> dict:
    history = recent_quotes(limit=30)
    if history and not force:
        latest_time = parse_local_datetime(history[0]["created_at"])
        if (now_local() - latest_time).total_seconds() < 3 * 60 * 60:
            return {"text": history[0]["quote_text"], "source": history[0]["source"], "updatedAt": history[0]["created_at"]}

    recent_text = {item["quote_text"] for item in history}
    chosen_text, chosen_source = QUOTE_BANK[0]
    for quote_text, source in QUOTE_BANK:
        if quote_text not in recent_text:
            chosen_text, chosen_source = quote_text, source
            break

    with db() as connection:
        connection.execute(
            "INSERT INTO quote_history(quote_text, source, created_at) VALUES(?, ?, ?)",
            (chosen_text, chosen_source, now_iso()),
        )
        connection.execute(
            """
            DELETE FROM quote_history
            WHERE id NOT IN (
                SELECT id FROM quote_history ORDER BY created_at DESC LIMIT 30
            )
            """
        )
    return {"text": chosen_text, "source": chosen_source, "updatedAt": now_iso()}


def set_quote(text: str, source: str) -> dict:
    with db() as connection:
        connection.execute(
            "INSERT INTO quote_history(quote_text, source, created_at) VALUES(?, ?, ?)",
            (text, source, now_iso()),
        )
        connection.execute(
            """
            DELETE FROM quote_history
            WHERE id NOT IN (
                SELECT id FROM quote_history ORDER BY created_at DESC LIMIT 30
            )
            """
        )
    return {"text": text, "source": source, "updatedAt": now_iso()}


def calendar_payload() -> dict:
    return {
        "connected": False,
        "message": "No calendar is connected yet.",
        "events": [],
        "connectSteps": [
            "Turn on calendar permission for this session when you want to use it.",
            "Add your Google Calendar client ID and client secret to the local backend.",
            "Use the Connect Calendar action once OAuth is wired in.",
        ],
    }


def search_web(query: str) -> dict:
    try:
        html = fetch_text(f"https://html.duckduckgo.com/html/?q={quote(query)}")
        results = []
        pattern = re.compile(
            r'<a[^>]*class="result__a"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>[\s\S]*?'
            r'<a[^>]*class="result__snippet"[^>]*>(?P<snippet>.*?)</a>',
            flags=re.IGNORECASE,
        )
        for match in pattern.finditer(html):
            href = unescape(match.group("href"))
            if "uddg=" in href:
                href = unquote(href.split("uddg=", 1)[1].split("&", 1)[0])
            title = strip_html(match.group("title"))
            snippet = strip_html(match.group("snippet"))
            if title and href:
                domain = urlparse(href).netloc.replace("www.", "")
                results.append(
                    {
                        "title": title,
                        "url": href,
                        "snippet": snippet,
                        "domain": domain,
                    }
                )
            if len(results) >= 6:
                break
        if results:
            return {
                "query": query,
                "results": results,
                "message": f"I found a few places to start for “{query}”. Pick the source you want.",
            }
    except Exception:
        pass

    return {
        "query": query,
        "results": [],
        "message": "I couldn’t fetch live search results right now. Try a more specific search phrase.",
    }


def summarize_source(url: str, title: str, question: str = "") -> dict:
    try:
        try:
            raw = fetch_text(f"https://r.jina.ai/http://{url.replace('https://', '').replace('http://', '')}")
        except Exception:
            raw = fetch_text(url)
        text = strip_html(raw)
        sentences = re.split(r"(?<=[.!?])\s+", text)
        keywords = [word.lower() for word in re.findall(r"[A-Za-z0-9]+", question) if len(word) > 2]
        picked = []
        for sentence in sentences:
            clean = sentence.strip()
            if len(clean) < 40:
                continue
            if keywords:
                hay = clean.lower()
                if any(word in hay for word in keywords):
                    picked.append(clean)
            elif len(picked) < 3:
                picked.append(clean)
            if len(picked) >= 4:
                break
        if not picked:
            picked = [sentence.strip() for sentence in sentences if len(sentence.strip()) > 40][:3]
        answer = " ".join(picked)[:1400] or "I could open the source, but I couldn’t extract a useful summary."
        return {
            "title": title,
            "url": url,
            "answer": answer,
            "source": f"Source: {title} — {url}",
            "question": question,
        }
    except Exception:
        return {
            "title": title,
            "url": url,
            "answer": "I couldn’t read that source properly. Try another result or open the link directly.",
            "source": f"Source: {title} — {url}",
            "question": question,
        }


def briefing_payload(reminders: list[dict], checkins: list[dict], quote: dict) -> dict:
    today = today_key()
    todays_reminders = [item for item in reminders if item["dayKey"] == today]
    open_checkins = [item for item in checkins if item["status"] == "active" and not item["isDoneToday"]]
    next_reminder = todays_reminders[0] if todays_reminders else None
    return {
        "dayLabel": now_local().strftime("%A, %d %b"),
        "summary": (
            f"Next reminder: {next_reminder['text']} at {next_reminder['displayTime']}."
            if next_reminder
            else "No fixed reminder is waiting right now."
        ),
        "quote": quote,
        "openCheckins": len(open_checkins),
    }


def app_state() -> dict:
    routines = list_routines()
    reminders = list_reminders()
    checkins = list_checkins()
    quote = rotate_quote(force=False)
    notes = list_notes()
    projects = list_projects()
    today = today_key()
    return {
        "routines": routines,
        "reminders": reminders,
        "checkins": checkins,
        "waterSettings": get_water_settings(),
        "currentQuote": quote,
        "quoteHistory": recent_quotes(limit=12),
        "notes": notes,
        "projects": projects,
        "permissions": PERMISSIONS,
        "calendar": calendar_payload(),
        "briefing": briefing_payload(reminders, checkins, quote),
        "stats": {
            "todaysReminders": sum(1 for item in reminders if item["dayKey"] == today),
            "openCheckins": sum(1 for item in checkins if item["status"] == "active" and not item["isDoneToday"]),
            "activeProjects": sum(1 for item in projects if item["status"] == "active"),
        },
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(raw)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode() or "{}")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(200, {"ok": True})

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self._send(200, app_state())
            return
        if parsed.path == "/api/quote":
            self._send(200, rotate_quote(force=True))
            return
        if parsed.path == "/api/search":
            query = parse_qs(parsed.query).get("q", [""])[0].strip()
            if not query:
                self._send(400, {"message": "Add a query first."})
                return
            self._send(200, search_web(query))
            return
        self._send(404, {"message": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        payload = self._body()

        if parsed.path == "/api/routines/daily":
            save_routine("daily", payload.get("content", "").strip() or DEFAULT_DAILY_PLAN)
            self._send(200, {"message": "Daily plan saved."})
            return

        if parsed.path == "/api/routines/weekly":
            save_routine("weekly", payload.get("content", "").strip() or DEFAULT_WEEKLY_PLAN)
            self._send(200, {"message": "Weekly routine saved."})
            return

        if parsed.path == "/api/reminders":
            remind_at = payload.get("remindAt", "").strip()
            text = payload.get("text", "").strip()
            if not text or not remind_at:
                self._send(400, {"message": "Reminder text and time are required."})
                return
            normalized = parse_local_datetime(remind_at).isoformat()
            with db() as connection:
                connection.execute(
                    "INSERT INTO reminders(text, remind_at, created_at) VALUES(?, ?, ?)",
                    (text, normalized, now_iso()),
                )
            self._send(200, {"message": "Reminder saved locally in SQLite."})
            return

        if parsed.path == "/api/checkins":
            text = payload.get("text", "").strip()
            time_of_day = payload.get("timeOfDay", "").strip()
            if not text or not time_of_day:
                self._send(400, {"message": "Check-in text and time are required."})
                return
            with db() as connection:
                connection.execute(
                    "INSERT INTO checkins(text, time_of_day, created_at) VALUES(?, ?, ?)",
                    (text, time_of_day, now_iso()),
                )
            self._send(200, {"message": "Daily check-in saved."})
            return

        if parsed.path == "/api/quotes/custom":
            text = payload.get("text", "").strip()
            source = payload.get("source", "").strip() or "custom"
            if not text:
                self._send(400, {"message": "Quote text is required."})
                return
            self._send(200, set_quote(text, source))
            return

        if parsed.path == "/api/search/source":
            url = payload.get("url", "").strip()
            title = payload.get("title", "").strip() or "Selected source"
            question = payload.get("question", "").strip()
            if not url:
                self._send(400, {"message": "A source URL is required."})
                return
            self._send(200, summarize_source(url, title, question))
            return

        if parsed.path == "/api/water-settings":
            save_water_settings(
                {
                    "intervalMinutes": int(payload.get("intervalMinutes", 120)),
                    "paused": bool(payload.get("paused", False)),
                }
            )
            self._send(200, {"message": "Water settings updated."})
            return

        if parsed.path == "/api/notes":
            text = payload.get("text", "").strip()
            if not text:
                self._send(400, {"message": "Note text is required."})
                return
            with db() as connection:
                connection.execute(
                    "INSERT INTO sticky_notes(text, color, created_at) VALUES(?, ?, ?)",
                    (text, payload.get("color", "wine"), now_iso()),
                )
            self._send(200, {"message": "Sticky note added."})
            return

        if parsed.path == "/api/projects":
            name = payload.get("name", "").strip()
            if not name:
                self._send(400, {"message": "Project name is required."})
                return
            with db() as connection:
                connection.execute(
                    "INSERT INTO projects(name, detail, status, created_at) VALUES(?, ?, ?, ?)",
                    (name, payload.get("detail", "").strip(), "active", now_iso()),
                )
            self._send(200, {"message": "Project added."})
            return

        self._send(404, {"message": "Not found"})

    def do_PATCH(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        payload = self._body()
        segments = parsed.path.strip("/").split("/")

        if len(segments) == 3 and segments[:2] == ["api", "checkins"]:
            checkin_id = int(segments[2])
            with db() as connection:
                if "status" in payload:
                    connection.execute("UPDATE checkins SET status = ? WHERE id = ?", (payload.get("status"), checkin_id))
                if payload.get("markDone"):
                    connection.execute(
                        "UPDATE checkins SET last_completed_on = ? WHERE id = ?",
                        (today_key(), checkin_id),
                    )
            self._send(200, {"message": "Check-in updated."})
            return

        if len(segments) == 3 and segments[:2] == ["api", "projects"]:
            project_id = int(segments[2])
            with db() as connection:
                connection.execute("UPDATE projects SET status = ? WHERE id = ?", (payload.get("status"), project_id))
            self._send(200, {"message": "Project updated."})
            return

        if len(segments) == 3 and segments[:2] == ["api", "permissions"]:
            permission_name = segments[2]
            if permission_name not in PERMISSIONS:
                self._send(404, {"message": "Unknown permission."})
                return
            PERMISSIONS[permission_name] = bool(payload.get("enabled"))
            self._send(200, {"message": f"{permission_name} permission updated for this session."})
            return

        self._send(404, {"message": "Not found"})

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        segments = parsed.path.strip("/").split("/")

        if len(segments) == 3 and segments[:2] == ["api", "reminders"]:
            reminder_id = int(segments[2])
            with db() as connection:
                connection.execute("UPDATE reminders SET status = 'deleted' WHERE id = ?", (reminder_id,))
            self._send(200, {"message": "Reminder deleted."})
            return

        if len(segments) == 3 and segments[:2] == ["api", "notes"]:
            note_id = int(segments[2])
            with db() as connection:
                connection.execute("DELETE FROM sticky_notes WHERE id = ?", (note_id,))
            self._send(200, {"message": "Sticky note removed."})
            return

        self._send(404, {"message": "Not found"})

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    init_db()
    server = ReusableThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    print("Assistant server running on http://127.0.0.1:8766")
    server.serve_forever()
