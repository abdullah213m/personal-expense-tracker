import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from app import create_app


class ExpenseTrackerTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        database = str(Path(self.temporary_directory.name) / "test.db")
        self.client = create_app({"TESTING": True, "DATABASE": database}).test_client()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def make_transaction(self, **overrides):
        transaction = {
            "description": "Market shop",
            "amount": 42.5,
            "type": "expense",
            "category": "Food & drink",
            "date": "2026-10-05",
        }
        transaction.update(overrides)
        return transaction

    def register(self, email="owner@example.com", name="Ledger Owner"):
        return self.client.post(
            "/register",
            data={"name": name, "email": email, "password": "secure-pass-123"},
            follow_redirects=True,
        )

    def test_home_page_renders_dashboard(self):
        response = self.register()
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Transactions", response.data)
        self.assertIn("₹0.00".encode(), response.data)
        self.assertNotIn(b"$", response.data)

    def test_create_filter_update_and_delete_transaction(self):
        self.register()
        created = self.client.post("/api/transactions", json=self.make_transaction())
        self.assertEqual(created.status_code, 201)
        transaction_id = created.get_json()["id"]

        filtered = self.client.get("/api/transactions?category=Food+%26+drink&search=Market")
        self.assertEqual(len(filtered.get_json()), 1)

        updated = self.client.put(
            f"/api/transactions/{transaction_id}",
            json=self.make_transaction(description="Farmers market", amount=50),
        )
        self.assertEqual(updated.get_json()["description"], "Farmers market")
        self.assertEqual(updated.get_json()["amount"], 50)

        deleted = self.client.delete(f"/api/transactions/{transaction_id}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.client.get("/api/transactions").get_json(), [])

    def test_rejects_invalid_transaction(self):
        self.register()
        response = self.client.post("/api/transactions", data=json.dumps(self.make_transaction(amount=-2)), content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("amount", response.get_json()["error"])

    def test_authentication_and_account_isolation(self):
        self.assertEqual(self.client.get("/api/transactions").status_code, 401)
        self.assertEqual(self.client.get("/").status_code, 302)
        self.register()
        created = self.client.post("/api/transactions", json=self.make_transaction())
        self.assertEqual(created.status_code, 201)

        self.client.post("/logout")
        second_user = self.client.post(
            "/register",
            data={"name": "Second User", "email": "second@example.com", "password": "another-pass-456"},
        )
        self.assertEqual(second_user.status_code, 302)
        self.assertEqual(self.client.get("/api/transactions").get_json(), [])

    def test_registration_validation_and_duplicate_email(self):
        short_password = self.client.post(
            "/register",
            data={"name": "Owner", "email": "owner@example.com", "password": "short"},
        )
        self.assertEqual(short_password.status_code, 400)
        self.register()
        self.client.post("/logout")
        duplicate = self.client.post(
            "/register",
            data={"name": "Another Owner", "email": "owner@example.com", "password": "secure-pass-456"},
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_existing_user_can_sign_in(self):
        self.register()
        self.client.post("/logout")
        self.assertEqual(self.client.get("/login").status_code, 200)

        invalid_login = self.client.post(
            "/login",
            data={"email": "owner@example.com", "password": "incorrect-password"},
        )
        self.assertEqual(invalid_login.status_code, 401)

        valid_login = self.client.post(
            "/login",
            data={"email": "owner@example.com", "password": "secure-pass-123"},
            follow_redirects=True,
        )
        self.assertEqual(valid_login.status_code, 200)
        self.assertIn(b"Income and Expense", valid_login.data)

    def test_savings_goal_creation_contribution_and_account_ownership(self):
        self.register()
        goal_response = self.client.post(
            "/api/goals",
            json={"name": "Rainy day fund", "target": 1000, "saved": 200, "deadline": "2027-06-01"},
        )
        self.assertEqual(goal_response.status_code, 201)
        goal = goal_response.get_json()
        self.assertEqual(goal["saved"], 200)

        contribution = self.client.post(
            f"/api/goals/{goal['id']}/contributions",
            json={"amount": 50},
        )
        self.assertEqual(contribution.status_code, 200)
        self.assertEqual(contribution.get_json()["saved"], 250)
        self.assertEqual(len(self.client.get("/api/goals").get_json()), 1)

        self.client.post("/logout")
        self.client.post(
            "/register",
            data={"name": "Second User", "email": "second@example.com", "password": "another-pass-456"},
        )
        self.assertEqual(self.client.get("/api/goals").get_json(), [])
        self.assertEqual(self.client.delete(f"/api/goals/{goal['id']}").status_code, 404)

    def test_monthly_income_and_goal_summary_support_near_target_alert(self):
        self.register()
        self.client.post(
            "/api/transactions",
            json=self.make_transaction(
                description="Monthly pay",
                amount=950,
                type="income",
                category="Income",
                date=date.today().isoformat(),
            ),
        )
        self.client.post("/api/goals", json={"name": "New laptop", "target": 1000, "saved": 0})
        summary = self.client.get("/api/summary").get_json()
        self.assertEqual(summary["income"], 950)
        self.assertEqual(summary["goals"][0]["target"], 1000)

    def test_summary_balance_and_cashflow_data(self):
        self.register()
        today = date.today().isoformat()
        self.client.post(
            "/api/transactions",
            json=self.make_transaction(description="Salary", amount=40000, type="income", category="Income", date=today),
        )
        self.client.post(
            "/api/transactions",
            json=self.make_transaction(description="Rent", amount=29000, type="expense", category="Home", date=today),
        )
        self.client.post("/api/goals", json={"name": "Manali Trip", "target": 10000, "saved": 0})
        summary = self.client.get("/api/summary").get_json()
        self.assertEqual(summary["income"], 40000)
        self.assertEqual(summary["expenses"], 29000)
        self.assertEqual(summary["balance"], 11000)
        self.assertEqual(len(summary["goals"]), 1)
        self.assertEqual(summary["goals"][0]["name"], "Manali Trip")
        self.assertEqual(summary["goals"][0]["target"], 10000)
        self.assertTrue(len(summary["months"]) >= 1)


if __name__ == "__main__":
    unittest.main()