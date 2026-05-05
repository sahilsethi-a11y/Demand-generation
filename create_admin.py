"""
One-time script to seed the first admin user.

Usage:
    python create_admin.py sahil@example.com MyPassword123
"""
import sys
from pathlib import Path

from dotenv import load_dotenv

_root = Path(__file__).resolve().parent
load_dotenv(dotenv_path=_root / ".env")
load_dotenv(dotenv_path=_root / ".env.local", override=True)

from backend.server.user_store import UserStore
from backend.server.auth_router import hash_password

DB_PATH = _root / "data" / "jobs.sqlite3"


def main():
    if len(sys.argv) != 3:
        print("Usage: python create_admin.py <email> <password>")
        sys.exit(1)

    email, password = sys.argv[1], sys.argv[2]
    store = UserStore(DB_PATH)
    store.init_db()

    if store.get_user_by_email(email):
        print(f"User {email} already exists.")
        sys.exit(0)

    user = store.create_user(email, hash_password(password), role="admin")
    print(f"Admin created: {user['email']} (role={user['role']})")


if __name__ == "__main__":
    main()
