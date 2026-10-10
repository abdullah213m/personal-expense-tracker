from __future__ import annotations

import math
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from typing import Any, Iterator

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash


EXPENSE_CATEGORIES = [
    "Food & drink",
    "Transport",
    "Shopping",
    "Bills",
    "Health",
    "Entertainment",
    "Home",
    "Travel",
    "Education",
    "Other",
]

INCOME_CATEGORIES = [
    "Salary / Wage",
    "Freelance & Consulting",
    "Business",
    "Investments",
    "Rental Income",
    "Bonus",
    "Gifts",
    "Other",
]

CATEGORIES = list(dict.fromkeys(EXPENSE_CATEGORIES + INCOME_CATEGORIES + ["Income"]))
TRANSACTION_TYPES = {"expense", "income"}


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)
    secret_key = os.environ.get("EXPENSE_TRACKER_SECRET")
    if secret_key is None:
        secret_path = Path(app.instance_path) / "secret.key"
        secret_path.parent.mkdir(parents=True, exist_ok=True)
        if not secret_path.exists():
            secret_path.write_text(secrets.token_hex(32), encoding="ascii")
        secret_key = secret_path.read_text(encoding="ascii").strip()
    app.config.from_mapping(
        DATABASE=os.environ.get("EXPENSE_TRACKER_DATABASE", str(Path(__file__).with_name("expenses.db"))),
        SECRET_KEY=secret_key,
    )
    if test_config:
        app.config.update(test_config)

    initialize_database(app.config["DATABASE"])

    @app.before_request
    def require_login():
        if request.endpoint in {"static", "login", "register", "logout"}:
            return None
        if session.get("user_id") is not None:
            return None
        if request.path.startswith("/api/"):
            return error_response("Please sign in to continue.", 401)
        return redirect(url_for("login"))

    @app.get("/")
    def index():
        return render_template(
            "index.html",
            categories=CATEGORIES,
            expense_categories=EXPENSE_CATEGORIES,
            income_categories=INCOME_CATEGORIES,
            user_name=session.get("user_name", "Your account"),
        )

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "GET":
            if session.get("user_id") is not None:
                return redirect(url_for("index"))
            return render_template("login.html", mode="login", error=None)

        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        with connect_database(app.config["DATABASE"]) as connection:
            user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user is None or not check_password_hash(user["password_hash"], password):
            return render_template("login.html", mode="login", error="That email and password combination was not found."), 401

        session.clear()
        session["user_id"] = user["id"]
        session["user_name"] = user["name"]
        return redirect(url_for("index"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if session.get("user_id") is not None:
            return redirect(url_for("index"))
        if request.method == "GET":
            return render_template("login.html", mode="register", error=None)

        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not name or len(name) > 60 or "@" not in email or len(email) > 254:
            return render_template("login.html", mode="register", error="Enter a name and a valid email address."), 400
        if len(password) < 8:
            return render_template("login.html", mode="register", error="Use a password with at least 8 characters."), 400

        try:
            with connect_database(app.config["DATABASE"]) as connection:
                cursor = connection.execute(
                    "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                    (name, email, generate_password_hash(password)),
                )
                user_id = cursor.lastrowid
                connection.execute("UPDATE transactions SET user_id = ? WHERE user_id IS NULL", (user_id,))
        except sqlite3.IntegrityError:
            return render_template("login.html", mode="register", error="An account with that email already exists."), 409

        session.clear()
        session["user_id"] = user_id
        session["user_name"] = name
        return redirect(url_for("index"))

    @app.post("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.get("/api/transactions")
    def list_transactions():
        clauses: list[str] = []
        values: list[str] = []

        for parameter, column in (("from", "date"), ("to", "date")):
            raw_value = request.args.get(parameter, "").strip()
            if raw_value:
                try:
                    date.fromisoformat(raw_value)
                except ValueError:
                    return error_response("Dates must use YYYY-MM-DD format.", 400)
                operator = ">=" if parameter == "from" else "<="
                clauses.append(f"{column} {operator} ?")
                values.append(raw_value)

        category = request.args.get("category", "").strip()
        if category:
            clauses.append("category = ?")
            values.append(category)

        transaction_type = request.args.get("type", "").strip()
        if transaction_type:
            if transaction_type not in TRANSACTION_TYPES:
                return error_response("Choose expense or income as the type.", 400)
            clauses.append("type = ?")
            values.append(transaction_type)

        search = request.args.get("search", "").strip()
        if search:
            clauses.append("(description LIKE ? OR category LIKE ?)")
            values.extend([f"%{search}%", f"%{search}%"])

        clauses.insert(0, "user_id = ?")
        values.insert(0, session["user_id"])
        sql = "SELECT * FROM transactions"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY date DESC, id DESC"

        with connect_database(app.config["DATABASE"]) as connection:
            process_recurring_incomes(session["user_id"], connection)
            transactions = [dict(row) for row in connection.execute(sql, values)]
        return jsonify(transactions)

    @app.get("/api/summary")
    def summary():
        today = date.today()
        month_start = today.replace(day=1).isoformat()
        first_month_index = today.year * 12 + today.month - 1 - 5
        first_year, first_month_offset = divmod(first_month_index, 12)
        chart_start = date(first_year, first_month_offset + 1, 1).isoformat()
        with connect_database(app.config["DATABASE"]) as connection:
            process_recurring_incomes(session["user_id"], connection)
            totals = connection.execute(
                """SELECT type, COALESCE(SUM(amount), 0) AS total
                         FROM transactions WHERE user_id = ? AND date >= ? AND date <= ? GROUP BY type""",
                      (session["user_id"], month_start, today.isoformat()),
            ).fetchall()
            monthly = {row["type"]: row["total"] for row in totals}
            category_rows = connection.execute(
                """SELECT category, SUM(amount) AS total FROM transactions
                         WHERE user_id = ? AND type = 'expense' AND date >= ? AND date <= ?
                    GROUP BY category ORDER BY total DESC""",
                      (session["user_id"], month_start, today.isoformat()),
            ).fetchall()
            month_rows = connection.execute(
                """SELECT substr(date, 1, 7) AS month,
                          SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
                          SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expenses
                         FROM transactions WHERE user_id = ? AND date >= ?
                    GROUP BY substr(date, 1, 7) ORDER BY month DESC LIMIT 6""",
                      (session["user_id"], chart_start),
            ).fetchall()
            goals = connection.execute(
                "SELECT id, name, target, saved, deadline FROM savings_goals WHERE user_id = ? ORDER BY id DESC",
                (session["user_id"],),
            ).fetchall()

            recurring = connection.execute(
                "SELECT id, title, amount, category, day_of_month, last_processed_month FROM recurring_incomes WHERE user_id = ? ORDER BY day_of_month ASC",
                (session["user_id"],),
            ).fetchall()

            daily_rows = connection.execute(
                """SELECT date,
                          SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income,
                          SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expenses
                     FROM transactions WHERE user_id = ?
                    GROUP BY date ORDER BY date ASC""",
                (session["user_id"],),
            ).fetchall()

            running_balance = 0
            timeline = []
            for row in daily_rows:
                inc = float(row["income"] or 0)
                exp = float(row["expenses"] or 0)
                running_balance += (inc - exp)
                timeline.append({
                    "date": row["date"],
                    "income": inc,
                    "expenses": exp,
                    "change": inc - exp,
                    "balance": running_balance,
                })

        return jsonify(
            {
                "month": today.strftime("%B %Y"),
                "income": monthly.get("income", 0),
                "expenses": monthly.get("expense", 0),
                "balance": monthly.get("income", 0) - monthly.get("expense", 0),
                "categories": [dict(row) for row in category_rows],
                "months": [dict(row) for row in reversed(month_rows)],
                "timeline": timeline,
                "goals": [dict(row) for row in goals],
                "recurring_incomes": [dict(row) for row in recurring],
            }
        )

    @app.get("/api/goals")
    def list_goals():
        with connect_database(app.config["DATABASE"]) as connection:
            goals = connection.execute(
                "SELECT id, name, target, saved, deadline FROM savings_goals WHERE user_id = ? ORDER BY id DESC",
                (session["user_id"],),
            ).fetchall()
        return jsonify([dict(goal) for goal in goals])

    @app.post("/api/goals")
    def create_goal():
        goal, error = read_goal_payload()
        if error:
            return error_response(error, 400)
        with connect_database(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                "INSERT INTO savings_goals (user_id, name, target, saved, deadline) VALUES (?, ?, ?, ?, ?)",
                (session["user_id"], goal["name"], goal["target"], goal["saved"], goal["deadline"]),
            )
            saved_goal = connection.execute(
                "SELECT id, name, target, saved, deadline FROM savings_goals WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        return jsonify(dict(saved_goal)), 201

    @app.post("/api/goals/<int:goal_id>/contributions")
    def contribute_to_goal(goal_id: int):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return error_response("Send a contribution amount as JSON.", 400)
        try:
            amount = float(payload.get("amount"))
        except (TypeError, ValueError):
            return error_response("Enter a valid contribution greater than zero.", 400)
        if not math.isfinite(amount) or amount <= 0:
            return error_response("Enter a valid contribution greater than zero.", 400)
        with connect_database(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                "UPDATE savings_goals SET saved = saved + ? WHERE id = ? AND user_id = ?",
                (round(amount, 2), goal_id, session["user_id"]),
            )
            if cursor.rowcount == 0:
                return error_response("Savings goal not found.", 404)
            goal = connection.execute(
                "SELECT id, name, target, saved, deadline FROM savings_goals WHERE id = ?",
                (goal_id,),
            ).fetchone()
        return jsonify(dict(goal))

    @app.delete("/api/goals/<int:goal_id>")
    def delete_goal(goal_id: int):
        with connect_database(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                "DELETE FROM savings_goals WHERE id = ? AND user_id = ?",
                (goal_id, session["user_id"]),
            )
        if cursor.rowcount == 0:
            return error_response("Savings goal not found.", 404)
        return "", 204

    @app.get("/api/recurring-incomes")
    def list_recurring_incomes():
        with connect_database(app.config["DATABASE"]) as connection:
            process_recurring_incomes(session["user_id"], connection)
            rows = connection.execute(
                "SELECT id, title, amount, category, day_of_month, last_processed_month FROM recurring_incomes WHERE user_id = ? ORDER BY day_of_month ASC",
                (session["user_id"],),
            ).fetchall()
        return jsonify([dict(row) for row in rows])

    @app.post("/api/recurring-incomes")
    def create_recurring_income():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return error_response("Send recurring income details as JSON.", 400)
        title = str(payload.get("title", "")).strip()
        category = str(payload.get("category", "")).strip()
        if not title or len(title) > 80:
            return error_response("Title is required and must be 80 characters or fewer.", 400)
        if category not in CATEGORIES:
            return error_response("Choose a valid category.", 400)
        try:
            amount = float(payload.get("amount"))
            day_of_month = int(payload.get("day_of_month", 1))
        except (TypeError, ValueError):
            return error_response("Enter valid amount and day of month.", 400)
        if not math.isfinite(amount) or amount <= 0:
            return error_response("Amount must be greater than zero.", 400)
        if day_of_month < 1 or day_of_month > 31:
            return error_response("Day of month must be between 1 and 31.", 400)

        with connect_database(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                "INSERT INTO recurring_incomes (user_id, title, amount, category, day_of_month) VALUES (?, ?, ?, ?, ?)",
                (session["user_id"], title, round(amount, 2), category, day_of_month),
            )
            process_recurring_incomes(session["user_id"], connection)
            saved = connection.execute(
                "SELECT id, title, amount, category, day_of_month, last_processed_month FROM recurring_incomes WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        return jsonify(dict(saved)), 201

    @app.delete("/api/recurring-incomes/<int:income_id>")
    def delete_recurring_income(income_id: int):
        with connect_database(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                "DELETE FROM recurring_incomes WHERE id = ? AND user_id = ?",
                (income_id, session["user_id"]),
            )
        if cursor.rowcount == 0:
            return error_response("Recurring income not found.", 404)
        return "", 204

    @app.post("/api/recurring-incomes/<int:income_id>/credit-now")
    def credit_recurring_income_now(income_id: int):
        today = date.today()
        current_month_str = today.strftime("%Y-%m")
        with connect_database(app.config["DATABASE"]) as connection:
            item = connection.execute(
                "SELECT * FROM recurring_incomes WHERE id = ? AND user_id = ?",
                (income_id, session["user_id"]),
            ).fetchone()
            if not item:
                return error_response("Recurring income not found.", 404)
            tx_date = today.isoformat()
            connection.execute(
                """INSERT INTO transactions (description, amount, type, category, date, user_id)
                     VALUES (?, ?, 'income', ?, ?, ?)""",
                (item["title"], item["amount"], item["category"], tx_date, session["user_id"]),
            )
            connection.execute(
                "UPDATE recurring_incomes SET last_processed_month = ? WHERE id = ?",
                (current_month_str, income_id),
            )
        return jsonify({"message": f"Successfully credited {item['title']} for {today.strftime('%B %Y')}."})

    @app.post("/api/transactions")
    def create_transaction():
        transaction, error = read_transaction_payload()
        if error:
            return error_response(error, 400)
        with connect_database(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                     """INSERT INTO transactions (description, amount, type, category, date, user_id)
                         VALUES (?, ?, ?, ?, ?, ?)""",
                     (*transaction.values(), session["user_id"]),
            )
            row = connection.execute("SELECT * FROM transactions WHERE id = ?", (cursor.lastrowid,)).fetchone()
            
            # If marked as recurring income, automatically save to recurring_incomes
            payload = request.get_json(silent=True) or {}
            if payload.get("is_recurring") and transaction["type"] == "income":
                day = date.fromisoformat(transaction["date"]).day
                connection.execute(
                    """INSERT INTO recurring_incomes (user_id, title, amount, category, day_of_month, last_processed_month)
                         VALUES (?, ?, ?, ?, ?, ?)""",
                    (session["user_id"], transaction["description"], transaction["amount"], transaction["category"], day, transaction["date"][:7]),
                )
        return jsonify(dict(row)), 201

    @app.put("/api/transactions/<int:transaction_id>")
    def update_transaction(transaction_id: int):
        transaction, error = read_transaction_payload()
        if error:
            return error_response(error, 400)
        with connect_database(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                """UPDATE transactions SET description = ?, amount = ?, type = ?, category = ?, date = ?
                         WHERE id = ? AND user_id = ?""",
                     (*transaction.values(), transaction_id, session["user_id"]),
            )
            if cursor.rowcount == 0:
                return error_response("Transaction not found.", 404)
            row = connection.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,)).fetchone()
        return jsonify(dict(row))

    @app.delete("/api/transactions/<int:transaction_id>")
    def delete_transaction(transaction_id: int):
        with connect_database(app.config["DATABASE"]) as connection:
            cursor = connection.execute(
                "DELETE FROM transactions WHERE id = ? AND user_id = ?",
                (transaction_id, session["user_id"]),
            )
        if cursor.rowcount == 0:
            return error_response("Transaction not found.", 404)
        return "", 204

    @app.post("/api/transactions/clear-all")
    def clear_all_transactions():
        with connect_database(app.config["DATABASE"]) as connection:
            connection.execute(
                "DELETE FROM transactions WHERE user_id = ?",
                (session["user_id"],),
            )
        return jsonify({"message": "All transactions have been cleared successfully."})

    return app


@contextmanager
def connect_database(database_path: str) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(database_path: str) -> None:
    Path(database_path).parent.mkdir(parents=True, exist_ok=True)
    with connect_database(database_path) as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                amount REAL NOT NULL CHECK (amount > 0),
                type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
                category TEXT NOT NULL,
                date TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS savings_goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                target REAL NOT NULL CHECK (target > 0),
                saved REAL NOT NULL DEFAULT 0 CHECK (saved >= 0),
                deadline TEXT
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS recurring_incomes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                amount REAL NOT NULL CHECK (amount > 0),
                category TEXT NOT NULL,
                day_of_month INTEGER NOT NULL CHECK (day_of_month >= 1 AND day_of_month <= 31),
                last_processed_month TEXT
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL
            )"""
        )
        transaction_columns = {row["name"] for row in connection.execute("PRAGMA table_info(transactions)")}
        if "user_id" not in transaction_columns:
            connection.execute("ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id)")


def process_recurring_incomes(user_id: int, connection: sqlite3.Connection) -> int:
    today = date.today()
    current_month_str = today.strftime("%Y-%m")
    current_day = today.day

    rows = connection.execute(
        "SELECT * FROM recurring_incomes WHERE user_id = ?",
        (user_id,),
    ).fetchall()

    added_count = 0
    for row in rows:
        day_of_month = row["day_of_month"]
        # If already processed for this month, skip to prevent re-inserting after user deletion
        if row["last_processed_month"] == current_month_str:
            continue

        # If we have reached or passed the day of the month
        if current_day >= day_of_month:
            tx_date = f"{current_month_str}-{min(day_of_month, 28):02d}"
            connection.execute(
                """INSERT INTO transactions (description, amount, type, category, date, user_id)
                     VALUES (?, ?, 'income', ?, ?, ?)""",
                (row["title"], row["amount"], row["category"], tx_date, user_id),
            )
            connection.execute(
                "UPDATE recurring_incomes SET last_processed_month = ? WHERE id = ?",
                (current_month_str, row["id"]),
            )
            added_count += 1

    return added_count


def read_transaction_payload() -> tuple[dict[str, Any], str | None]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return {}, "Send transaction details as JSON."

    description = str(payload.get("description", "")).strip()
    category = str(payload.get("category", "")).strip()
    transaction_type = str(payload.get("type", "")).strip()
    transaction_date = str(payload.get("date", "")).strip()

    if not description or len(description) > 100:
        return {}, "Description is required and must be 100 characters or fewer."
    if category not in CATEGORIES:
        return {}, "Choose a valid category."
    if transaction_type not in TRANSACTION_TYPES:
        return {}, "Choose expense or income as the type."
    try:
        amount = float(payload.get("amount"))
    except (TypeError, ValueError):
        return {}, "Enter a valid amount greater than zero."
    if not math.isfinite(amount) or amount <= 0:
        return {}, "Enter a valid amount greater than zero."
    try:
        date.fromisoformat(transaction_date)
    except ValueError:
        return {}, "Choose a valid transaction date."

    return {
        "description": description,
        "amount": round(amount, 2),
        "type": transaction_type,
        "category": category,
        "date": transaction_date,
    }, None


def read_goal_payload() -> tuple[dict[str, Any], str | None]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return {}, "Send savings goal details as JSON."
    name = str(payload.get("name", "")).strip()
    deadline = str(payload.get("deadline", "")).strip()
    if not name or len(name) > 80:
        return {}, "Goal name is required and must be 80 characters or fewer."
    try:
        target = float(payload.get("target"))
        saved = float(payload.get("saved", 0))
    except (TypeError, ValueError):
        return {}, "Enter valid target and saved amounts."
    if not math.isfinite(target) or target <= 0 or not math.isfinite(saved) or saved < 0:
        return {}, "Target must be positive and saved amount cannot be negative."
    if deadline:
        try:
            date.fromisoformat(deadline)
        except ValueError:
            return {}, "Choose a valid goal deadline."
    return {"name": name, "target": round(target, 2), "saved": round(saved, 2), "deadline": deadline or None}, None


def error_response(message: str, status: int):
    return jsonify({"error": message}), status


app = create_app()


if __name__ == "__main__":
    app.run(debug=False)