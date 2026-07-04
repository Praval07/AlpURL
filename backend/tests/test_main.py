import pytest
from fastapi.testclient import TestClient
from backend.app.main import app, get_db
import mongomock

# Setup clean testing MongoDB DB using mongomock for isolated, offline testing
@pytest.fixture(scope="module")
def db_session():
    client = mongomock.MongoClient()
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

def test_user_registration(client, db_session):
    # Register a new user
    payload = {
        "first_name": "Antigravity",
        "last_name": "Tester",
        "email": "tester@alpurl.dev",
        "password": "strongpassword123"
    }
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "user" in data
    assert data["user"]["email"] == "tester@alpurl.dev"

    # Check MongoDB contains the hashed password
    user_in_db = db_session.users.find_one({"email": "tester@alpurl.dev"})
    assert user_in_db is not None
    assert user_in_db["password_hash"] is not None
    assert user_in_db["password_hash"] != "strongpassword123"

def test_user_login(client):
    # Valid login
    response = client.post("/api/auth/login", json={"email": "tester@alpurl.dev", "password": "strongpassword123"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"

    # Invalid login
    response = client.post("/api/auth/login", json={"email": "tester@alpurl.dev", "password": "wrongpassword"})
    assert response.status_code == 400
    assert "Invalid email or password" in response.json()["detail"]
