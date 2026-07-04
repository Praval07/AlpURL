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
    userId: Optional[str] = Field(None, alias="userId")
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
    userId: Optional[str] = Field(None, alias="userId")
    name: str
    short_key: str
    url: str
    short_url: str
    clicks: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: str = "active"

class Analytics(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    userId: Optional[str] = Field(None, alias="userId")
    short_key: str
    ip_address: str = "127.0.0.1"
    user_agent: Optional[str] = None
    browser: Optional[str] = "Unknown"
    os: Optional[str] = "Unknown"
    device: Optional[str] = "Unknown"
    referrer: Optional[str] = "Direct"
    country: Optional[str] = "Unknown"
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class Domain(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    userId: Optional[str] = Field(None, alias="userId")
    domain: str
    status: str = "pending"
    ssl_enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Notification(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    userId: Optional[str] = Field(None, alias="userId")
    type: str
    icon: str
    title: str
    body: str
    time_label: str
    read: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)

class Settings(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    userId: Optional[str] = Field(None, alias="userId")
    workspace_name: str = "My Workspace"
    default_domain: str = "alp.url"
    timezone: str = "Asia/Kolkata (IST)"
    language: str = "English (US)"
    date_format: str = "YYYY-MM-DD"
    
    # Profile info
    first_name: str = "User"
    last_name: str = ""
    username: str = "user"
    email: str = "user@example.com"
    bio: Optional[str] = "New user on AlpURL"
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

def init_db():
    """Establishes connection and sets indexes."""
    db_manager.connect()
    db = db_manager.get_db()
    
    # Ensure indexes exist
    try:
        db.links.create_index("short_key", unique=True)
        db.links.create_index("created_at")
        db.analytics.create_index([("short_key", 1), ("timestamp", -1)])
        db.domains.create_index("domain", unique=True)
        db.users.create_index("email", unique=True)
        print("[MongoDB] Database indexes verified.")
    except Exception as e:
        print(f"[MongoDB Index Warning] Failed to verify or create indexes: {e}")

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
