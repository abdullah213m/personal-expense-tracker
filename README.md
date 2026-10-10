# Ledgerly Expense Tracker

A local personal expense tracker built with Python, Flask, SQLite, and a plain HTML/CSS/JavaScript frontend. All amounts are displayed in Indian rupees (INR).

## Run locally

1. Create and activate a Python virtual environment if you want project dependencies isolated.
2. Install dependencies with `pip install -r requirements.txt`.
3. Start the app with `python app.py`.
4. Open `http://127.0.0.1:5000` in your browser.

The SQLite database is created automatically as `expenses.db` in the project folder. Set `EXPENSE_TRACKER_DATABASE` to store it elsewhere.
Flask's session signing key is generated locally in `instance/secret.key` and reused after restarts. Set `EXPENSE_TRACKER_SECRET` to provide your own key.
Create a local account on first visit, then sign in with that email and password on future visits. Passwords are stored as hashes, and each account can only access its own transactions.

## Features

- Record, edit, and delete income and expenses.
- Review this month's income, spending, and balance.
- See recent cash flow and a monthly spending breakdown by category.
- Search and filter transactions by type, category, and date range.
- Store data locally in SQLite.
- Create an account and securely sign in to a private transaction ledger.
- Set savings targets, record contributions, and get a dashboard alert when monthly income reaches 90% of a goal's target.
- Export transactions to CSV.

## Tests

Run the focused application tests with `python -m unittest discover -s tests`.