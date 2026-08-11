"""
Personal Expense Tracker - Console Application
Final Project

Author: <your name here>
"""

import csv
import os
from datetime import datetime

DATA_FILE = "expenses.csv"
DATE_FORMAT = "%d-%m-%Y"


class Expense:
    """Blueprint for a single expense record."""

    def __init__(self, exp_id, title, amount, category, date):
        self.id = exp_id
        self.title = title
        self.amount = amount
        self.category = category
        self.date = date

    def to_row(self):
        # used when writing back to the csv
        return [self.id, self.title, f"{self.amount:.2f}", self.category, self.date]


class ExpenseTracker:
    """Holds all the expenses in memory and does the CRUD work."""

    def __init__(self, filename=DATA_FILE):
        self.filename = filename
        self.expenses = []
        self.next_id = 101  # first id starts at 101, matches the sample output
        self.load_data()

    # ---------------- persistence ----------------

    def load_data(self):
        if not os.path.exists(self.filename):
            return

        with open(self.filename, "r", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)  # skip header row
            for row in reader:
                if not row:
                    continue
                try:
                    exp_id = int(row[0])
                    title = row[1]
                    amount = float(row[2])
                    category = row[3]
                    date = row[4]
                    self.expenses.append(Expense(exp_id, title, amount, category, date))
                except (ValueError, IndexError):
                    # skip a corrupted row instead of crashing on load
                    continue

        if self.expenses:
            self.next_id = max(e.id for e in self.expenses) + 1

    def save_data(self):
        with open(self.filename, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["id", "title", "amount", "category", "date"])
            for exp in self.expenses:
                writer.writerow(exp.to_row())

    # ---------------- core features ----------------

    def add_expense(self):
        title = input("Enter Expense Title: ").strip()

        # keep asking until a valid amount is entered
        while True:
            amount_str = input("Enter Expense Amount: ").strip()
            try:
                amount = float(amount_str)
                break
            except ValueError:
                print("--> [ERROR]: Invalid monetary value. Please enter a valid numerical decimal amount.")

        category = input("Enter Expense Category: ").strip()
        if category == "":
            category = "Uncategorized"

        date_str = input("Enter Expense Date (DD-MM-YYYY) or leave blank for today: ").strip()
        if date_str == "":
            date_str = datetime.now().strftime(DATE_FORMAT)
            print(f"--> [SYSTEM]: Blank detected. Auto-assigned current timestamp date: {date_str}")
        else:
            # keep asking until the date actually matches DD-MM-YYYY
            while not self.is_valid_date(date_str):
                print("--> [ERROR]: Invalid date format. Please use DD-MM-YYYY.")
                date_str = input("Enter Expense Date (DD-MM-YYYY) or leave blank for today: ").strip()
                if date_str == "":
                    date_str = datetime.now().strftime(DATE_FORMAT)
                    break

        new_exp = Expense(self.next_id, title, amount, category, date_str)
        self.expenses.append(new_exp)
        print(f"\nSuccess: New record securely appended! [Generated ID: {self.next_id}]")
        self.next_id += 1

    def view_expenses(self):
        if not self.expenses:
            print("\nNo expenses recorded yet.")
            return

        print("\n" + "-" * 65)
        print(f"{'ID':<6}{'Title':<20}{'Amount':<12}{'Category':<15}{'Date':<10}")
        print("-" * 65)
        for exp in self.expenses:
            print(f"{exp.id:<6}{exp.title:<20}Rs.{exp.amount:<9.2f}{exp.category:<15}{exp.date:<10}")
        print("-" * 65)

    def search_expense(self):
        try:
            search_id = int(input("Enter Expense ID to search: ").strip())
        except ValueError:
            print("--> [ERROR]: ID must be a number.")
            return

        for exp in self.expenses:
            if exp.id == search_id:
                print("\nRecord Found:")
                print(f"ID: {exp.id} | Title: {exp.title} | Amount: Rs.{exp.amount:.2f} "
                      f"| Category: {exp.category} | Date: {exp.date}")
                return

        print(f"--> [ERROR]: No record found with ID {search_id}.")

    def update_expense(self):
        try:
            update_id = int(input("Enter Expense ID to update: ").strip())
        except ValueError:
            print("--> [ERROR]: ID must be a number.")
            return

        target = None
        for exp in self.expenses:
            if exp.id == update_id:
                target = exp
                break

        if target is None:
            print(f"--> [ERROR]: No record found with ID {update_id}.")
            return

        print("Leave a field blank to keep it unchanged.")

        new_title = input(f"New Title (current: {target.title}): ").strip()
        if new_title:
            target.title = new_title

        new_amount = input(f"New Amount (current: {target.amount:.2f}): ").strip()
        if new_amount:
            try:
                target.amount = float(new_amount)
            except ValueError:
                print("--> [ERROR]: Invalid amount, keeping old value.")

        new_category = input(f"New Category (current: {target.category}): ").strip()
        if new_category:
            target.category = new_category

        new_date = input(f"New Date (current: {target.date}): ").strip()
        if new_date:
            if self.is_valid_date(new_date):
                target.date = new_date
            else:
                print("--> [ERROR]: Invalid date format, keeping old value.")

        print("Success: Record updated.")

    def delete_expense(self):
        try:
            del_id = int(input("Enter Expense ID to delete: ").strip())
        except ValueError:
            print("--> [ERROR]: ID must be a number.")
            return

        for exp in self.expenses:
            if exp.id == del_id:
                self.expenses.remove(exp)
                print(f"Success: Record with ID {del_id} deleted.")
                return

        print(f"--> [ERROR]: No record found with ID {del_id}.")

    def view_summary(self):
        if not self.expenses:
            print("\nNo expenses to summarize yet.")
            return

        grand_total = sum(exp.amount for exp in self.expenses)

        # category-wise breakdown
        breakdown = {}
        for exp in self.expenses:
            breakdown[exp.category] = breakdown.get(exp.category, 0) + exp.amount

        print("\n" + "=" * 60)
        print("FINANCIAL TELEMETRY DASHBOARD".center(60))
        print("=" * 60)
        print("\n--- COMPREHENSIVE STATUS SUMMARY ---")
        print(f"Grand Combined Total Expenditures : Rs.{grand_total:,.2f}")
        print(f"Total Active Unique Tracked Items : {len(self.expenses)} Records")

        print("\n--- DYNAMIC CATEGORY-WISE BREAKDOWN ---")
        for category, total in breakdown.items():
            print(f"{category:<15}: Rs.{total:,.2f}")

        print("=" * 60)

    # ---------------- helper ----------------

    @staticmethod
    def is_valid_date(date_str):
        try:
            datetime.strptime(date_str, DATE_FORMAT)
            return True
        except ValueError:
            return False

    # ---------------- menu loop ----------------

    def run(self):
        while True:
            print("\n=== PERSONAL EXPENSE TRACKER ===")
            print("1. Add New Expense")
            print("2. View All Expenses")
            print("3. Search Expense")
            print("4. Update Expense")
            print("5. Delete Expense")
            print("6. View Summary Metrics")
            print("7. Exit & Save Data")

            choice = input("Choose option (1-7): ").strip()

            if choice == "1":
                self.add_expense()
            elif choice == "2":
                self.view_expenses()
            elif choice == "3":
                self.search_expense()
            elif choice == "4":
                self.update_expense()
            elif choice == "5":
                self.delete_expense()
            elif choice == "6":
                self.view_summary()
            elif choice == "7":
                self.save_data()
                print("Data saved. Goodbye!")
                break
            else:
                print("--> [ERROR]: Please choose a valid option between 1 and 7.")


if __name__ == "__main__":
    tracker = ExpenseTracker()
    tracker.run()
