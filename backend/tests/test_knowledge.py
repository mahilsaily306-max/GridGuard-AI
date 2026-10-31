from __future__ import annotations

from app.database import database
from app.knowledge import REFERENCE_SOURCE, seed_reference_knowledge


def _headers(client) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"username": "operator", "password": "Operator@123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_reference_knowledge_seed_is_idempotent_and_complete(client):
    seed_reference_knowledge()
    seed_reference_knowledge()

    with database() as conn:
        count = conn.execute("SELECT COUNT(*) FROM knowledge_entries").fetchone()[0]
    assert count == 20

    response = client.get("/api/knowledge-base", headers=_headers(client))
    assert response.status_code == 200
    reference = [item for item in response.json() if item["entry_type"] == "reference_guidance"]
    assert len(reference) == 20
    assert all(item["source_classification"] == REFERENCE_SOURCE for item in reference)
    assert all(item["id"].startswith("KB-REF-") for item in reference)
    assert all(item["created_at"] for item in reference)
    required = {
        "title",
        "category",
        "simple_explanation",
        "warning_signs",
        "possible_causes",
        "relevant_measurements",
        "safe_inspection_considerations",
        "preventive_recommendations",
    }
    assert all(required.issubset(item) for item in reference)


def test_knowledge_search_and_category_filter(client):
    headers = _headers(client)
    category = client.get(
        "/api/knowledge-base?category=Complaint%20Handling",
        headers=headers,
    )
    assert category.status_code == 200
    assert len(category.json()) == 4
    assert all(item["category"] == "Complaint Handling" for item in category.json())

    search = client.get("/api/knowledge-base?query=rainfall", headers=headers)
    assert search.status_code == 200
    assert search.json()
    assert any("rainfall" in str(item).lower() for item in search.json())


def test_knowledge_base_requires_authentication(client):
    assert client.get("/api/knowledge-base").status_code == 401
