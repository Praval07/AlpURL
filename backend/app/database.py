import os
import urllib.parse
from datetime import datetime
import pymongo
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, AutoReconnect
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

# ═══════════════════════════════════════════════════════════════
#  ENVIRONMENT VARIABLES LOADING
# ═══════════════════════════════════════════════════════════════
def load_env_local():
    """Manually parses .env.local if present in the workspace root."""
    # Find root path (3 directories up from backend/app/database.py)
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_path = os.path.join(root_dir, ".env.local")
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()

def get_mongodb_uri() -> str:
    """Retrieves and processes MONGODB_URI, dynamically substituting credentials."""
    load_env_local()
    
    uri = os.getenv("MONGODB_URI")
    password = os.getenv("MONGODB_PASSWORD")
    
    if not uri:
        # Default fallback uri if not configured
        uri = "mongodb+srv://pravalsaxena:${MONGODB_PASSWORD}@praval.jdtptd6.mongodb.net/alpurl?retryWrites=true&w=majority&appName=Praval"
    if not password:
        password = "@Pra#886"  # Fallback
        
    # URL encode password since it contains special characters (@ and #)
    encoded_password = urllib.parse.quote_plus(password)
    
    # Replace placeholder password safely
    uri = uri.replace("${MONGODB_PASSWORD}", encoded_password)
    uri = uri.replace("<@pra#886>", encoded_password)
    uri = uri.replace("<@Pra#886>", encoded_password)
    
    return uri

# ═══════════════════════════════════════════════════════════════
#  DATABASE CONNECTION MANAGER (Singleton & Pooling)
# ═══════════════════════════════════════════════════════════════
class MongoDBManager:
    _instance = None
    _client = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(MongoDBManager, cls).__new__(cls, *args, **kwargs)
        return cls._instance

    def connect(self):
        """Initializes connection to MongoDB Atlas with connection pooling."""
        if self._client is not None:
            return
            
        uri = get_mongodb_uri()
        print(f"[MongoDB] Initializing MongoClient (pool: 5-50 connections)...")
        try:
            self._client = MongoClient(
                uri,
                maxPoolSize=50,
                minPoolSize=5,
                serverSelectionTimeoutMS=5000,
                retryWrites=True,
                w="majority"
            )
            # Ping database to force validation
            self._client.admin.command("ping")
            print("[MongoDB] Successfully connected to Atlas cluster.")
        except Exception as e:
            print(f"[MongoDB Critical Error] Failed to connect to Atlas cluster: {e}")
            print(f"[MongoDB] Falling back to in-memory mongomock database for offline execution.")
            try:
                import mongomock
                self._client = mongomock.MongoClient()
                print("[MongoDB] Successfully initialized in-memory mongomock database.")
            except ImportError:
                print("[MongoDB] mongomock is not installed. Re-raising original exception.")
                raise e

    def get_db(self):
        """Returns the alpurl database instance."""
        if self._client is None:
            self.connect()
        return self._client.get_database("alpurl")

    def close(self):
        """Closes the client connection pool gracefully."""
        if self._client is not None:
            print("[MongoDB] Closing client connection pool gracefully...")
            self._client.close()
            self._client = None

db_manager = MongoDBManager()

# ═══════════════════════════════════════════════════════════════
#  PRODUCTION DATA MODELS (Pydantic V2)
# ═══════════════════════════════════════════════════════════════
class User(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    first_name: str
    last_name: str
    email: str
    password_hash: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "active"

class Link(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    short_key: str
    long_url: str
    custom_alias: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expiry_date: Optional[datetime] = None
    qr_code_enabled: bool = False
    campaign: Optional[str] = None
    domain: str = "alp.url"
    status: str = "active"  # active, paused, archived
    is_deleted: bool = False

class QRCode(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    name: str
    short_key: str
    url: str
    short_url: str
    clicks: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "active"

class Analytics(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    short_key: str
    ip_address: str = "127.0.0.1"
    user_agent: Optional[str] = None
    browser: Optional[str] = "Unknown"
    os: Optional[str] = "Unknown"
    device: Optional[str] = "Unknown"
    referrer: Optional[str] = "Direct"
    country: Optional[str] = "Unknown"
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class Campaign(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    name: str
    status: str = "active"
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class Domain(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    domain: str
    status: str = "pending"
    ssl_enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Notification(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    type: str
    icon: str
    title: str
    body: str
    time_label: str
    read: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Settings(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    workspace_name: str = "Praval's Workspace"
    default_domain: str = "alp.url"
    timezone: str = "Asia/Kolkata (IST)"
    language: str = "English (US)"
    date_format: str = "YYYY-MM-DD"
    
    # Profile info
    first_name: str = "Praval"
    last_name: str = "Sharma"
    username: str = "praval07"
    email: str = "praval@alpurl.dev"
    bio: Optional[str] = "Software Engineer & SaaS builder"
    avatar_url: Optional[str] = "https://lh3.googleusercontent.com/aida-public/AB6AXuCx8QSHp37bk4zf_yrQCyiRr7v3y4ex5kb4ZneWieTJ0L5z6ZnvnsBtLW2mCETL1EURJqEDU7bjb6bo8pN6fhBYCfDX5PbEPQuupcAkXl28oWWvosXm8c_7RsA3b0RcS8EXLvZtCapp5jZl9YbN4BRODqcCnHQFNBM_guWrynhA7HDzk5sEPd2mDTv1767qTHxUkWsGS8Pnx4e3nB5QOlfyD_2fZanTs5k5mbhmE9YGA-XSAtCfnhotVg"
    
    # Notifications switches
    notif_milestones: bool = True
    notif_insights: bool = True
    notif_domains: bool = True
    notif_digest: bool = True
    notif_security: bool = True
    notif_updates: bool = False
    
    # Appearance
    theme: str = "dark"
    accent_color: str = "blue"
    font_size: str = "medium"
    compact_mode: bool = False

class APIKey(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    key_val: str
    name: str = "Default Key"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "active"

class Workspace(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    name: str
    owner_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Team(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    name: str
    members: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)

class AuditLog(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    action: str
    user: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    details: Dict[str, Any] = {}

# ═══════════════════════════════════════════════════════════════
#  DATABASE INITIALIZER & SEEDER
# ═══════════════════════════════════════════════════════════════
def init_db():
    """Establishes connection, sets indexes, and seeds database if empty."""
    db_manager.connect()
    db = db_manager.get_db()
    
    # Ensure indexes exist
    try:
        db.links.create_index("short_key", unique=True)
        db.links.create_index("created_at")
        db.analytics.create_index([("short_key", 1), ("timestamp", -1)])
        db.campaigns.create_index("name", unique=True)
        db.domains.create_index("domain", unique=True)
        db.apiKeys.create_index("key_val", unique=True)
        db.users.create_index("email", unique=True)
        print("[MongoDB] Database indexes verified.")
    except Exception as e:
        print(f"[MongoDB Index Warning] Failed to verify or create indexes: {e}")

    # Seed Database if links collection is empty
    if db.links.count_documents({}) == 0:
        print("[MongoDB Seeder] Pre-populating AlpURL with telemetry data...")
        from datetime import timedelta
        import random
        
        mappings_data = [
            ("google", "https://www.google.com/search?q=alpurl", "google", True, "Google Search Promo", "alp.url", 30),
            ("github", "https://github.com/Praval07/AlpURL", "github", False, "GitHub Open Source", "alp.url", 25),
            ("stripe", "https://stripe.com/docs/api", "stripe", True, "Stripe API Integration Docs", "alp.url", 20),
            ("vercel", "https://vercel.com/dashboard", "vercel", False, "Vercel Hosting Deployments", "alp.url", 15),
            ("tailwind", "https://tailwindcss.com/docs/v4", "tailwind", True, "Tailwind CSS Layout Guidelines", "alp.url", 10),
            ("fastapi", "https://fastapi.tiangolo.com/advanced", "fastapi", False, "FastAPI High Performance Specs", "alp.url", 5),
        ]
        
        seeded_links = []
        for short_key, long_url, alias, qr, campaign, domain, days_ago in mappings_data:
            created_at = datetime.utcnow() - timedelta(days=days_ago)
            expiry_date = datetime.utcnow() + timedelta(days=365 * 2)
            
            link_doc = {
                "_id": short_key,
                "short_key": short_key,
                "long_url": long_url,
                "custom_alias": alias,
                "created_at": created_at,
                "expiry_date": expiry_date,
                "qr_code_enabled": qr,
                "campaign": campaign,
                "domain": domain,
                "status": "active",
                "is_deleted": False
            }
            db.links.insert_one(link_doc)
            seeded_links.append(link_doc)
            
            # If QR code enabled, seed qrCodes collection
            if qr:
                db.qrCodes.insert_one({
                    "_id": f"qr-{short_key}",
                    "name": alias or short_key,
                    "short_key": short_key,
                    "url": f"https://{domain}/{short_key}",
                    "short_url": short_key,
                    "clicks": 0,
                    "created_at": created_at,
                    "status": "active"
                })
        
        browsers = ["Chrome", "Firefox", "Safari", "Edge", "Opera"]
        oss = ["Windows 11", "macOS Sonoma", "iOS 17", "Android 14", "Linux Ubuntu"]
        devices = ["Desktop", "Mobile", "Tablet"]
        referrers = ["Direct", "https://github.com", "https://t.co", "https://news.ycombinator.com", "https://google.com"]
        countries = ["United States", "Germany", "United Kingdom", "India", "France", "Canada", "Australia", "Japan"]
        
        analytics_docs = []
        for _ in range(350):
            m = random.choice(seeded_links)
            max_days = (datetime.utcnow() - m["created_at"]).days
            random_days = random.randint(0, max_days) if max_days > 0 else 0
            random_hours = random.randint(0, 23)
            random_minutes = random.randint(0, 59)
            timestamp = m["created_at"] + timedelta(days=random_days, hours=random_hours, minutes=random_minutes)
            
            browser = random.choice(browsers)
            os_name = random.choice(oss)
            device = "Mobile" if "iOS" in os_name or "Android" in os_name else random.choice(devices)
            referrer = random.choice(referrers)
            country = random.choice(countries)
            ip = f"192.168.1.{random.randint(10, 250)}"
            
            analytics_docs.append({
                "short_key": m["short_key"],
                "ip_address": ip,
                "user_agent": f"Mozilla/5.0 (Mock {browser}; {os_name})",
                "browser": browser,
                "os": os_name,
                "device": device,
                "referrer": referrer,
                "country": country,
                "timestamp": timestamp
            })
            
        if analytics_docs:
            db.analytics.insert_many(analytics_docs)
            print(f"[MongoDB Seeder] Seeded 6 links and {len(analytics_docs)} analytics records.")

    # Seed Campaigns
    if db.campaigns.count_documents({}) == 0:
        db.campaigns.insert_many([
            {"name": "Summer Sale 2026", "status": "active", "start_date": "2026-06-15", "end_date": "2026-08-31"},
            {"name": "Product Hunt Launch", "status": "active", "start_date": "2026-06-05", "end_date": "2026-06-15"},
            {"name": "Developer Outreach", "status": "active", "start_date": "2026-06-01", "end_date": "2026-07-31"},
            {"name": "Beta Launch V3", "status": "paused", "start_date": "2026-06-25", "end_date": "2026-09-30"}
        ])
        print("[MongoDB Seeder] Seeded campaigns.")

    # Seed Domains
    if db.domains.count_documents({}) == 0:
        db.domains.insert_many([
            {"domain": "alp.url", "status": "verified", "ssl_enabled": True, "created_at": datetime.utcnow()},
            {"domain": "go.alpurl.dev", "status": "verified", "ssl_enabled": True, "created_at": datetime.utcnow()},
            {"domain": "lnk.alpurl.io", "status": "pending", "ssl_enabled": True, "created_at": datetime.utcnow()}
        ])
        print("[MongoDB Seeder] Seeded domains.")

    # Seed API Keys
    if db.apiKeys.count_documents({}) == 0:
        db.apiKeys.insert_one({
            "key_val": "alp_live_8f3c2a9d4b6e8f1a",
            "name": "Production API Key",
            "created_at": datetime.utcnow(),
            "status": "active"
        })
        print("[MongoDB Seeder] Seeded API key.")

    # Seed Notifications
    if db.notifications.count_documents({}) == 0:
        db.notifications.insert_many([
            {"type": "milestone", "icon": "local_fire_department", "title": "Milestone Reached 🔥", "body": "Your link 'summer' just surpassed 12,000 clicks!", "time_label": "2 min ago", "read": False, "created_at": datetime.utcnow()},
            {"type": "insight", "icon": "psychology", "title": "AI Insight", "body": "Twitter referral traffic up 45% this week — viral link detected.", "time_label": "18 min ago", "read": False, "created_at": datetime.utcnow()},
            {"type": "success", "icon": "verified", "title": "Domain Verified", "body": "go.alpurl.dev is now active and serving redirects.", "time_label": "1 hr ago", "read": False, "created_at": datetime.utcnow()},
            {"type": "info", "icon": "analytics", "title": "Weekly Digest Ready", "body": "Your analytics report for June 25 – July 1 is available.", "time_label": "3 hrs ago", "read": True, "created_at": datetime.utcnow()}
        ])
        print("[MongoDB Seeder] Seeded notifications.")

    # Seed User Settings
    if db.settings.count_documents({}) == 0:
        db.settings.insert_one({
            "workspace_name": "Praval's Workspace",
            "default_domain": "alp.url",
            "timezone": "Asia/Kolkata (IST)",
            "language": "English (US)",
            "date_format": "YYYY-MM-DD",
            "first_name": "Praval",
            "last_name": "Sharma",
            "username": "praval07",
            "email": "praval@alpurl.dev",
            "bio": "Software Engineer & SaaS builder",
            "avatar_url": "https://lh3.googleusercontent.com/aida-public/AB6AXuCx8QSHp37bk4zf_yrQCyiRr7v3y4ex5kb4ZneWieTJ0L5z6ZnvnsBtLW2mCETL1EURJqEDU7bjb6bo8pN6fhBYCfDX5PbEPQuupcAkXl28oWWvosXm8c_7RsA3b0RcS8EXLvZtCapp5jZl9YbN4BRODqcCnHQFNBM_guWrynhA7HDzk5sEPd2mDTv1767qTHxUkWsGS8Pnx4e3nB5QOlfyD_2fZanTs5k5mbhmE9YGA-XSAtCfnhotVg",
            "notif_milestones": True,
            "notif_insights": True,
            "notif_domains": True,
            "notif_digest": True,
            "notif_security": True,
            "notif_updates": False,
            "theme": "dark",
            "accent_color": "blue",
            "font_size": "medium",
            "compact_mode": False
        })
        print("[MongoDB Seeder] Seeded default settings.")

def get_db():
    """FastAPI Dependency injection generator yielding MongoDB database."""
    db = db_manager.get_db()
    try:
        yield db
    except Exception as e:
        print(f"[MongoDB dependency failure] Session error: {e}")
        raise e

def hash_password(password: str) -> str:
    """Hashes a password securely using PBKDF2-HMAC-SHA256."""
    import hashlib
    import os
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return salt.hex() + ":" + key.hex()

def verify_password(stored_password_hash: str, provided_password: str) -> bool:
    """Verifies a password against its stored PBKDF2-HMAC-SHA256 hash."""
    import hashlib
    if not stored_password_hash or ":" not in stored_password_hash:
        return False
    try:
        salt_hex, key_hex = stored_password_hash.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected_key = bytes.fromhex(key_hex)
        key = hashlib.pbkdf2_hmac('sha256', provided_password.encode('utf-8'), salt, 100000)
        return key == expected_key
    except Exception:
        return False
