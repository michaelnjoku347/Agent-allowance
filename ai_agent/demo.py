import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from planner import select_resource
import os

ROOT = Path(__file__).resolve().parents[1]

# Demo catalog. Addresses come from your team's rules.json.
RESOURCES = [
    {
        "id": "weather-basic",
        "description": "Morning weather brief",
        "keywords": ("weather", "forecast"),
        "price": "3",
    },
    {
        "id": "market-basic",
        "description": "Market pricing report",
        "keywords": ("market", "pricing", "prices"),
        "price": "8",
    },
]


def check_purchase(resource, rules, spent="0"):
    """Local preview only. The payment backend must recheck before signing."""
    try:
        amount = Decimal(resource["price"])
        used = Decimal(spent)
        budget = Decimal(rules["budget"])
        limit = Decimal(rules["maxPerPurchase"])

        if not all(x.is_finite() for x in (amount, used, budget, limit)):
            raise ValueError("Amounts must be finite")
        if amount <= 0 or used < 0 or budget <= 0 or limit <= 0:
            raise ValueError("Invalid amount or allowance")

        expiry = datetime.fromisoformat(
            rules["expiresAt"].replace("Z", "+00:00")
        )
        if expiry.tzinfo is None:
            raise ValueError("Expiry must include a timezone")
    except (KeyError, ValueError, InvalidOperation):
        return "BLOCK", "Invalid purchase or allowance configuration"

    if datetime.now(timezone.utc) >= expiry:
        return "BLOCK", "Allowance expired"

    approved = {address.lower() for address in rules["allowedMerchants"]}
    if resource["merchant"].lower() not in approved:
        return "BLOCK", "Merchant is not approved"

    if used + amount > budget:
        return "BLOCK", "Not enough available budget"

    if amount > limit:
        return "REQUIRES_APPROVAL", "Above the per-purchase limit"

    return "ALLOW", "Within the allowance"


def main():
    rules = json.loads(
        (ROOT / "agent" / "rules.json").read_text(encoding="utf-8-sig")
    )

    if not rules["allowedMerchants"]:
        print("No approved merchants configured.")
        return

    # Use the configured addresses for this local demonstration.
    catalog = [
        {
            **item,
            "merchant": rules["allowedMerchants"][
                index % len(rules["allowedMerchants"])
            ],
        }
        for index, item in enumerate(RESOURCES)
    ]

    print("LOCAL DEMO — keyword selection, simulated spending, no payments")
    task = input("Task: ").strip().lower()

    plan = select_resource(task, catalog)

    if plan["resource"] is None:
        print(plan["reason"])
        return

    selected = plan["resource"]
    decision, reason = check_purchase(selected, rules, spent="0")

    print(json.dumps({
        "mode": "local_demo",
        "resourceId": selected["id"],
        "description": selected["description"],
        "price": selected["price"],
        "currency": "RLUSD",
        "decision": decision,
        "reason": reason,
        "paymentExecuted": False,
    }, indent=2))


if __name__ == "__main__":
    main()
    api_key = os.getenv("AWS_BEARER_TOKEN_BEDROCK")
    region = os.getenv("AWS_DEFAULT_REGION")

    print("Bedrock key configured:", bool(api_key))
    print("AWS region:", region or "NOT SET")

from bedrock_check import check_bedrock

if input("Run one billable Bedrock test? Type YES: ").strip() == "YES":
    check_bedrock()