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

# Shared state to pass tokens across tests
class TestState:
    user1_token = None
    user2_token = None
    anon_short_key = None

def test_user_registration(client, db_session):
    # Register user1
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
    assert "token" in data
    assert "user" in data
    assert data["user"]["email"] == "tester@alpurl.dev"
    TestState.user1_token = data["token"]

    # Check MongoDB contains the settings
    user_in_db = db_session.users.find_one({"email": "tester@alpurl.dev"})
    assert user_in_db is not None
    assert user_in_db["password_hash"] is not None

def test_user_login(client):
    # Valid login
    response = client.post("/api/auth/login", json={"email": "tester@alpurl.dev", "password": "strongpassword123"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "token" in data

    # Invalid login
    response = client.post("/api/auth/login", json={"email": "tester@alpurl.dev", "password": "wrongpassword"})
    assert response.status_code == 400
    assert "Invalid email or password" in response.json()["detail"]

def test_auth_route_protection(client):
    # Try calling dashboard stats without token
    response = client.get("/api/dashboard-stats")
    assert response.status_code == 401

def test_user1_shorten_url(client):
    headers = {"Authorization": f"Bearer {TestState.user1_token}"}
    response = client.post(
        "/api/shorten",
        json={"long_url": "https://www.google.com", "custom_alias": "goog-test"},
        headers=headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["short_key"] == "goog-test"
    assert data["userId"] != "anonymous"

def test_user1_dashboard_stats(client):
    headers = {"Authorization": f"Bearer {TestState.user1_token}"}
    response = client.get("/api/dashboard-stats", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total_links"] == 1

def test_user2_registration_and_isolation(client):
    # Register user2
    payload = {
        "first_name": "Antigravity2",
        "last_name": "Tester2",
        "email": "tester2@alpurl.dev",
        "password": "strongpassword123"
    }
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 200
    data = response.json()
    TestState.user2_token = data["token"]

    # Verify user2 dashboard stats has 0 links (data isolation!)
    headers = {"Authorization": f"Bearer {TestState.user2_token}"}
    response = client.get("/api/dashboard-stats", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total_links"] == 0

def test_anonymous_shorten_and_redirect(client):
    # Shorten as guest
    response = client.post(
        "/api/shorten",
        json={"long_url": "https://example.com"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["userId"] == "anonymous"
    short_key = data["short_key"]

    # Test redirect
    response = client.get(f"/{short_key}", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "https://example.com"

def test_static_routes_and_seo(client):
    # Test sitemap
    res = client.get("/sitemap.xml")
    assert res.status_code == 200
    assert "application/xml" in res.headers["content-type"]
    assert "https://alpurl.vercel.app/" in res.text

    # Test robots
    res = client.get("/robots.txt")
    assert res.status_code == 200
    assert "text/plain" in res.headers["content-type"]
    assert "User-agent: *" in res.text

    # Test pre-rendered dynamic SEO page title
    res = client.get("/about")
    assert res.status_code == 200
    assert "About AlpURL" in res.text

    res = client.get("/login")
    assert res.status_code == 200
    assert "Login | AlpURL" in res.text

def test_bot_redirection_interception(client, db_session):
    # Shorten a link
    res = client.post("/api/shorten", json={"long_url": "https://example.com/target"})
    assert res.status_code == 200
    short_key = res.json()["short_key"]

    # Regular user request (redirects)
    res_user = client.get(f"/{short_key}", follow_redirects=False)
    assert res_user.status_code == 307
    assert res_user.headers["location"] == "https://example.com/target"

    # Social scraper bot request (serves bot HTML)
    bot_headers = {"User-Agent": "Slackbot 1.0 (+https://api.slack.com/robots)"}
    res_bot = client.get(f"/{short_key}", headers=bot_headers, follow_redirects=False)
    assert res_bot.status_code == 200
    assert "<meta property=\"og:title\"" in res_bot.text
    assert "https://example.com/target" in res_bot.text
