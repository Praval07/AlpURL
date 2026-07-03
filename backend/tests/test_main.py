import pytest
from fastapi.testclient import TestClient
from backend.app.main import app, get_db
from backend.app.database import get_mongodb_uri
from pymongo import MongoClient

# Setup clean testing MongoDB Atlas DB using an independent connection for teardown safety
@pytest.fixture(scope="module")
def db_session():
    uri = get_mongodb_uri()
    client = MongoClient(uri)
    test_db = client.get_database("alpurl_test")
    
    # Drop all collections prior to tests to ensure isolation
    collections_to_clean = ["links", "qrCodes", "analytics", "campaigns", "domains", "apiKeys", "users", "settings"]
    for collection in collections_to_clean:
        test_db[collection].drop()
        
    try:
        yield test_db
    finally:
        # Clean up test database collections after tests
        for collection in collections_to_clean:
            test_db[collection].drop()
        client.close()

@pytest.fixture(scope="module")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()

def test_shorten_url(client):
    response = client.post(
        "/api/shorten",
        json={"long_url": "https://www.google.com", "custom_alias": "goog-test"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["short_key"] == "goog-test"
    assert "short_url" in data
    assert data["long_url"] == "https://www.google.com"

def test_shorten_duplicate_alias(client):
    response = client.post(
        "/api/shorten",
        json={"long_url": "https://example.com", "custom_alias": "goog-test"}
    )
    assert response.status_code == 400
    assert "already in use" in response.json()["detail"]

def test_redirect_to_url(client):
    # Test valid redirect
    response = client.get("/goog-test", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "https://www.google.com"

def test_redirect_non_existent(client):
    response = client.get("/non-existent")
    assert response.status_code == 404

def test_dashboard_stats(client):
    response = client.get("/api/dashboard-stats")
    assert response.status_code == 200
    data = response.json()
    assert "total_links" in data
    assert "total_clicks" in data
    assert data["total_links"] == 1
