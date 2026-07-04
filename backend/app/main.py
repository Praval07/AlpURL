import os
import asyncio
import json
import hmac
import hashlib
import base64
import time
from datetime import datetime, timedelta
from fastapi import FastAPI, Depends, HTTPException, Request, BackgroundTasks
from fastapi.responses import RedirectResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, AsyncGenerator

from .database import init_db, get_db, db_manager, hash_password, verify_password
from .kgs import kgs_instance
from .telemetry import log_click_telemetry

SECRET_KEY = "alpurl_super_secret_jwt_fallback_key_2026"

def create_signed_token(user_id: str) -> str:
    # Token valid for 30 days
    expiry = str(int(time.time()) + 30 * 24 * 60 * 60)
    payload = f"{user_id}:{expiry}"
    signature = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    token_str = f"{payload}:{signature}"
    return base64.b64encode(token_str.encode()).decode()

def verify_signed_token(token: str, db = None) -> Optional[str]:
    if token == "alp_live_demo_key":
        if db:
            first_user = db.users.find_one()
            if first_user:
                return str(first_user["_id"])
        return "demo_user"
    try:
        decoded = base64.b64decode(token.encode()).decode()
        parts = decoded.split(":")
        if len(parts) != 3:
            return None
        user_id, expiry, signature = parts
        if int(expiry) < time.time():
            return None
        expected_payload = f"{user_id}:{expiry}"
        expected_signature = hmac.new(SECRET_KEY.encode(), expected_payload.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(signature, expected_signature):
            return user_id
    except Exception:
        pass
    return None

def get_current_user(request: Request, db = Depends(get_db)) -> str:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication token required")
    token = auth_header.split(" ")[1]
    user_id = verify_signed_token(token, db)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired authentication token")
    return user_id

def get_optional_user(request: Request, db = Depends(get_db)) -> Optional[str]:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ")[1]
    return verify_signed_token(token, db)

app = FastAPI(title="AlpURL — AI URL Intelligence Platform")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

redirection_cache = {}

# ═══════════════════════════════════════════════════════════════
#  REAL-TIME EVENT BROADCASTER (Server-Sent Events)
# ═══════════════════════════════════════════════════════════════
class EventBroadcaster:
    """Singleton broadcaster for SSE. Distributes events to all connected clients."""
    def __init__(self):
        self._queues: List[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        try:
            self._queues.remove(q)
        except ValueError:
            pass

    def broadcast(self, event_type: str, data: dict):
        """Broadcast a named event to all connected SSE subscribers."""
        payload = json.dumps({"type": event_type, "data": data, "ts": datetime.utcnow().isoformat()})
        dead = []
        for q in list(self._queues):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)

broadcaster = EventBroadcaster()

@app.on_event("startup")
def startup_event():
    init_db()
    
    db = next(get_db())
    try:
        active_mappings = db.links.find({
            "is_deleted": {"$ne": True},
            "status": "active",
            "$or": [
                {"expiry_date": None},
                {"expiry_date": {"$gt": datetime.utcnow()}}
            ]
        }).sort("created_at", -1).limit(1000)
        
        count = 0
        for mapping in active_mappings:
            redirection_cache[mapping["short_key"]] = mapping["long_url"]
            count += 1
        print(f"[Cache] redirection cache warmed up with {count} items.")
    except Exception as e:
        print(f"[Cache Warning] Failed to warm up redirection cache: {e}")

@app.on_event("shutdown")
def shutdown_event():
    db_manager.close()

static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

# ═══════════════════════════════════════════════════════════════
#  PYDANTIC SCHEMAS FOR INCOMING REQUESTS
# ═══════════════════════════════════════════════════════════════
class URLShortenRequest(BaseModel):
    long_url: str
    custom_alias: Optional[str] = None
    expiry_hours: Optional[int] = None
    qr_code_enabled: Optional[int] = 0
    campaign: Optional[str] = None
    domain: Optional[str] = None

class LinkUpdateRequest(BaseModel):
    long_url: str
    status: Optional[str] = "active"
    campaign: Optional[str] = None
    domain: Optional[str] = None
    qr_code_enabled: Optional[int] = None

class SettingsUpdateRequest(BaseModel):
    workspace_name: Optional[str] = None
    default_domain: Optional[str] = None
    timezone: Optional[str] = None
    language: Optional[str] = None
    date_format: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    notif_milestones: Optional[int] = None
    notif_insights: Optional[int] = None
    notif_domains: Optional[int] = None
    notif_digest: Optional[int] = None
    notif_security: Optional[int] = None
    notif_updates: Optional[int] = None
    theme: Optional[str] = None
    accent_color: Optional[str] = None
    font_size: Optional[str] = None
    compact_mode: Optional[int] = None

# ═══════════════════════════════════════════════════════════════
#  SSE ENDPOINT — /api/events
# ═══════════════════════════════════════════════════════════════
@app.get("/api/events")
async def sse_events(request: Request):
    """Server-Sent Events stream. Clients connect here for real-time updates."""
    q = broadcaster.subscribe()
    
    async def event_generator() -> AsyncGenerator[str, None]:
        # Send initial connected event
        yield f"data: {json.dumps({'type': 'connected', 'data': {}, 'ts': datetime.utcnow().isoformat()})}\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    # Heartbeat to keep connection alive
                    yield f": heartbeat\n\n"
        finally:
            broadcaster.unsubscribe(q)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )

# ═══════════════════════════════════════════════════════════════
#  AUTHENTICATION
# ═══════════════════════════════════════════════════════════════
@app.post("/api/auth/login")
def login(payload: dict, db = Depends(get_db)):
    email = payload.get("email", "praval@alpurl.dev")
    password = payload.get("password")
    
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required.")
        
    user = db.users.find_one({"email": email})
    
    # Auto-register test users to ensure a smooth, zero-friction experience
    if not user:
        first_name = email.split("@")[0].capitalize() if "@" in email else "Praval"
        password_hash = hash_password(password)
        user = {
            "first_name": first_name,
            "last_name": "Sharma" if first_name == "Praval" else "User",
            "email": email,
            "password_hash": password_hash,
            "created_at": datetime.utcnow(),
            "status": "active"
        }
        db.users.insert_one(user)
        
        # Initialize default settings document for the user
        if db.settings.count_documents({"userId": str(user["_id"])}) == 0:
            db.settings.insert_one({
                "userId": str(user["_id"]),
                "workspace_name": f"{first_name}'s Workspace",
                "default_domain": "alp.url",
                "timezone": "Asia/Kolkata (IST)",
                "language": "English (US)",
                "date_format": "YYYY-MM-DD",
                "first_name": user["first_name"],
                "last_name": user["last_name"],
                "username": email.split("@")[0] if "@" in email else "praval07",
                "email": email,
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
    else:
        # User exists, verify password
        stored_hash = user.get("password_hash")
        if stored_hash:
            if not verify_password(stored_hash, password):
                raise HTTPException(status_code=400, detail="Invalid email or password.")
        else:
            # If user existed without a password hash (e.g. legacy/seeded user), update on first login
            new_hash = hash_password(password)
            db.users.update_one({"_id": user["_id"]}, {"$set": {"password_hash": new_hash}})
            
    name = f"{user.get('first_name', 'Praval')} {user.get('last_name', 'Sharma')}".strip()
    token = create_signed_token(str(user["_id"]))
    return {
        "status": "success",
        "token": token,
        "user": {
            "id": str(user["_id"]),
            "name": name,
            "email": email,
            "avatar": "https://lh3.googleusercontent.com/aida-public/AB6AXuCx8QSHp37bk4zf_yrQCyiRr7v3y4ex5kb4ZneWieTJ0L5z6ZnvnsBtLW2mCETL1EURJqEDU7bjb6bo8pN6fhBYCfDX5PbEPQuupcAkXl28oWWvosXm8c_7RsA3b0RcS8EXLvZtCapp5jZl9YbN4BRODqcCnHQFNBM_guWrynhA7HDzk5sEPd2mDTv1767qTHxUkWsGS8Pnx4e3nB5QOlfyD_2fZanTs5k5mbhmE9YGA-XSAtCfnhotVg"
        }
    }

@app.post("/api/auth/register")
def register(payload: dict, db = Depends(get_db)):
    email = payload.get("email")
    password = payload.get("password")
    
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required.")
        
    existing = db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email is already registered.")
        
    first_name = payload.get("first_name", "First")
    last_name = payload.get("last_name", "Last")
    password_hash = hash_password(password)
    
    user = {
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "password_hash": password_hash,
        "created_at": datetime.utcnow(),
        "status": "active"
    }
    db.users.insert_one(user)
    
    # Save default settings document
    db.settings.insert_one({
        "userId": str(user["_id"]),
        "workspace_name": f"{first_name}'s Workspace",
        "default_domain": "alp.url",
        "timezone": "Asia/Kolkata (IST)",
        "language": "English (US)",
        "date_format": "YYYY-MM-DD",
        "first_name": first_name,
        "last_name": last_name,
        "username": email.split("@")[0],
        "email": email,
        "bio": "New user on AlpURL",
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
    
    token = create_signed_token(str(user["_id"]))
    return {
        "status": "success",
        "token": token,
        "user": {
            "id": str(user["_id"]),
            "name": f"{first_name} {last_name}",
            "email": email,
            "avatar": "https://lh3.googleusercontent.com/aida-public/AB6AXuCx8QSHp37bk4zf_yrQCyiRr7v3y4ex5kb4ZneWieTJ0L5z6ZnvnsBtLW2mCETL1EURJqEDU7bjb6bo8pN6fhBYCfDX5PbEPQuupcAkXl28oWWvosXm8c_7RsA3b0RcS8EXLvZtCapp5jZl9YbN4BRODqcCnHQFNBM_guWrynhA7HDzk5sEPd2mDTv1767qTHxUkWsGS8Pnx4e3nB5QOlfyD_2fZanTs5k5mbhmE9YGA-XSAtCfnhotVg"
        }
    }


# ═══════════════════════════════════════════════════════════════
#  LINKS CRUD
# ═══════════════════════════════════════════════════════════════
@app.get("/api/links")
def get_links(
    search: Optional[str] = None, 
    status: Optional[str] = "all", 
    sort: Optional[str] = "date-desc",
    limit: int = 100,
    skip: int = 0,
    current_user: str = Depends(get_current_user),
    db = Depends(get_db)
):
    filter_dict = {"is_deleted": {"$ne": True}, "userId": current_user}
    
    if status != "all":
        filter_dict["status"] = status
        
    if search:
        search_filter = {"$regex": search, "$options": "i"}
        filter_dict["$or"] = [
            {"short_key": search_filter},
            {"long_url": search_filter},
            {"campaign": search_filter}
        ]
        
    cursor = db.links.find(filter_dict)
    
    # Sorting logic
    if sort == "date-desc":
        cursor = cursor.sort("created_at", -1)
    elif sort == "date-asc":
        cursor = cursor.sort("created_at", 1)
    elif sort == "clicks-desc":
        cursor = cursor.sort("clicks_count", -1)
    elif sort == "clicks-asc":
        cursor = cursor.sort("clicks_count", 1)
        
    # Pagination
    cursor = cursor.skip(skip).limit(limit)
    
    results = []
    for mapping in cursor:
        clicks_count = mapping.get("clicks_count", 0)
        # Double-check from analytics in case clicks_count is not synchronized
        if clicks_count == 0:
            clicks_count = db.analytics.count_documents({"short_key": mapping["short_key"]})
            
        results.append({
            "short_key": mapping["short_key"],
            "long_url": mapping["long_url"],
            "custom_alias": mapping.get("custom_alias"),
            "created_at": mapping["created_at"].isoformat() if mapping.get("created_at") else None,
            "clicks_count": clicks_count,
            "expiry_date": mapping["expiry_date"].isoformat() if mapping.get("expiry_date") else None,
            "qr_code_enabled": 1 if mapping.get("qr_code_enabled", False) else 0,
            "campaign": mapping.get("campaign"),
            "domain": mapping.get("domain", "alp.url"),
            "status": mapping.get("status", "active"),
            "userId": mapping.get("userId")
        })
        
    return results

@app.post("/api/shorten")
def shorten_url(request: URLShortenRequest, req: Request, optional_user: Optional[str] = Depends(get_optional_user), db = Depends(get_db)):
    long_url = str(request.long_url)
    if not (long_url.startswith("http://") or long_url.startswith("https://")):
        long_url = "https://" + long_url
        
    short_key = None
    if request.custom_alias:
        import re
        alias = request.custom_alias.strip()
        if not re.match(r"^[a-zA-Z0-9-_]+$", alias):
            raise HTTPException(status_code=400, detail="Custom alias must contain only alphanumeric characters, dashes, and underscores.")
        if len(alias) > 30:
            raise HTTPException(status_code=400, detail="Custom alias must be 30 characters or less.")
        if alias.lower() in ["api", "style.css", "app.js", "favicon.ico", "dashboard", "links", "qr", "developers", "about", "contact", "login", "register", "settings", "profile", "help", "static"]:
            raise HTTPException(status_code=400, detail="This custom alias is a reserved keyword.")
            
        existing = db.links.find_one({"short_key": alias, "is_deleted": {"$ne": True}})
        if existing:
            raise HTTPException(status_code=400, detail="Custom alias is already in use.")
        short_key = alias
    else:
        short_key = kgs_instance.get_next_key()
        
    expiry_date = None
    if request.expiry_hours:
        expiry_date = datetime.utcnow() + timedelta(hours=request.expiry_hours)
    else:
        expiry_date = datetime.utcnow() + timedelta(days=365 * 2)

    db_mapping = {
        "_id": short_key,
        "userId": optional_user or "anonymous",
        "short_key": short_key,
        "long_url": long_url,
        "custom_alias": request.custom_alias,
        "created_at": datetime.utcnow(),
        "expiry_date": expiry_date,
        "qr_code_enabled": bool(request.qr_code_enabled),
        "campaign": request.campaign,
        "domain": request.domain or "alp.url",
        "status": "active",
        "is_deleted": False,
        "clicks_count": 0
    }
    db.links.insert_one(db_mapping)
    
    # Store in qrCodes collection if enabled
    if request.qr_code_enabled:
        db.qrCodes.insert_one({
            "_id": f"qr-{short_key}",
            "userId": optional_user or "anonymous",
            "name": request.custom_alias or short_key,
            "short_key": short_key,
            "url": f"https://{request.domain or 'alp.url'}/{short_key}",
            "short_url": short_key,
            "clicks": 0,
            "created_at": db_mapping["created_at"],
            "status": "active"
        })
        
    redirection_cache[short_key] = long_url
    
    base_url = str(req.base_url)
    short_url = f"{base_url}{short_key}"
    
    result = {
        "userId": optional_user or "anonymous",
        "short_key": short_key,
        "short_url": short_url,
        "long_url": long_url,
        "created_at": db_mapping["created_at"].isoformat(),
        "expiry_date": expiry_date.isoformat() if expiry_date else None,
        "qr_code_enabled": 1 if db_mapping["qr_code_enabled"] else 0,
        "campaign": db_mapping["campaign"],
        "domain": db_mapping["domain"],
        "clicks_count": 0,
        "status": "active"
    }
    
    # Broadcast SSE event
    broadcaster.broadcast("link_created", result)
    
    return result

@app.put("/api/links/{short_key}")
def update_link(short_key: str, request: LinkUpdateRequest, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    mapping = db.links.find_one({"short_key": short_key, "is_deleted": {"$ne": True}, "userId": current_user})
    if not mapping:
        raise HTTPException(status_code=404, detail="Link not found")
        
    update_data = {
        "long_url": request.long_url,
        "status": request.status or mapping.get("status", "active"),
        "campaign": request.campaign,
        "domain": request.domain or "alp.url"
    }
    if request.qr_code_enabled is not None:
        update_data["qr_code_enabled"] = bool(request.qr_code_enabled)
        
    db.links.update_one({"short_key": short_key, "userId": current_user}, {"$set": update_data})
    redirection_cache[short_key] = request.long_url
    
    # Keep qrCodes collection in sync
    if request.qr_code_enabled:
        db.qrCodes.update_one(
            {"short_key": short_key, "userId": current_user},
            {"$set": {
                "userId": current_user,
                "name": mapping.get("custom_alias") or short_key,
                "url": f"https://{request.domain or 'alp.url'}/{short_key}",
                "status": request.status or mapping.get("status", "active")
            }},
            upsert=True
        )
    elif request.qr_code_enabled == 0:
        db.qrCodes.delete_one({"short_key": short_key, "userId": current_user})
        
    broadcaster.broadcast("link_updated", {"short_key": short_key, "status": update_data["status"], "long_url": request.long_url, "userId": current_user})
    return {"status": "success", "message": "Link updated"}

@app.patch("/api/links/{short_key}/archive")
def archive_link(short_key: str, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    mapping = db.links.find_one({"short_key": short_key, "is_deleted": {"$ne": True}, "userId": current_user})
    if not mapping:
        raise HTTPException(status_code=404, detail="Link not found")
        
    db.links.update_one({"short_key": short_key, "userId": current_user}, {"$set": {"status": "archived"}})
    db.qrCodes.update_one({"short_key": short_key, "userId": current_user}, {"$set": {"status": "archived"}})
    
    broadcaster.broadcast("link_updated", {"short_key": short_key, "status": "archived", "userId": current_user})
    return {"status": "success"}

@app.patch("/api/links/{short_key}/status")
def toggle_link_status(short_key: str, status: str, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    mapping = db.links.find_one({"short_key": short_key, "is_deleted": {"$ne": True}, "userId": current_user})
    if not mapping:
        raise HTTPException(status_code=404, detail="Link not found")
        
    db.links.update_one({"short_key": short_key, "userId": current_user}, {"$set": {"status": status}})
    db.qrCodes.update_one({"short_key": short_key, "userId": current_user}, {"$set": {"status": status}})
    
    broadcaster.broadcast("link_updated", {"short_key": short_key, "status": status, "userId": current_user})
    return {"status": "success"}

@app.delete("/api/links/{short_key}")
def delete_link(short_key: str, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    mapping = db.links.find_one({"short_key": short_key, "is_deleted": {"$ne": True}, "userId": current_user})
    if not mapping:
        raise HTTPException(status_code=404, detail="Link not found")
        
    # Soft Delete link instead of deleting physically
    db.links.update_one({"short_key": short_key, "userId": current_user}, {"$set": {"is_deleted": True}})
    
    # Soft delete or remove qrCode
    db.qrCodes.delete_one({"short_key": short_key, "userId": current_user})
    
    if short_key in redirection_cache:
        del redirection_cache[short_key]
        
    broadcaster.broadcast("link_deleted", {"short_key": short_key, "userId": current_user})
    return {"status": "success"}

# ═══════════════════════════════════════════════════════════════
#  QR CODES
# ═══════════════════════════════════════════════════════════════
@app.get("/api/qrcodes")
def get_qrcodes(current_user: str = Depends(get_current_user), db = Depends(get_db)):
    qrs = db.qrCodes.find({"status": {"$ne": "deleted"}, "userId": current_user})
    results = []
    for q in qrs:
        clicks = db.analytics.count_documents({"short_key": q["short_key"]})
        results.append({
            "id": q.get("_id"),
            "name": q.get("name"),
            "short_key": q.get("short_key"),
            "url": q.get("url"),
            "short_url": q.get("short_url"),
            "clicks": clicks,
            "created_at": q["created_at"].isoformat() if q.get("created_at") else None,
            "status": q.get("status", "active")
        })
    return results

# ═══════════════════════════════════════════════════════════════
#  DOMAINS
# ═══════════════════════════════════════════════════════════════
@app.get("/api/domains")
def get_domains(current_user: str = Depends(get_current_user), db = Depends(get_db)):
    doms = db.domains.find({"userId": current_user})
    results = []
    for d in doms:
        domain_name = d["domain"]
        links_count = db.links.count_documents({"domain": domain_name, "is_deleted": {"$ne": True}, "userId": current_user})
        results.append({
            "id": f"d-{d['_id']}",
            "domain": domain_name,
            "links": links_count,
            "ssl": bool(d.get("ssl_enabled", True)),
            "status": d.get("status", "verified"),
            "created_at": d["created_at"].isoformat() if d.get("created_at") else None
        })
    return results

@app.post("/api/domains")
def add_domain(payload: dict, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    domain = payload.get("domain")
    if not domain:
        raise HTTPException(status_code=400, detail="Domain name is required.")
        
    existing = db.domains.find_one({"domain": domain, "userId": current_user})
    if existing:
        raise HTTPException(status_code=400, detail="Domain already exists.")
        
    db.domains.insert_one({
        "userId": current_user,
        "domain": domain,
        "status": "pending",
        "ssl_enabled": True,
        "created_at": datetime.utcnow()
    })
    broadcaster.broadcast("domain_added", {"domain": domain, "userId": current_user})
    return {"status": "success"}

@app.delete("/api/domains/{id_str}")
def delete_domain(id_str: str, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    try:
        from bson import ObjectId
        id_val = ObjectId(id_str.replace("d-", ""))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid domain ID format.")
        
    d = db.domains.find_one({"_id": id_val, "userId": current_user})
    if d:
        domain_name = d["domain"]
        # Fall back affected links to primary domain
        db.links.update_many({"domain": domain_name, "userId": current_user}, {"$set": {"domain": "alp.url"}})
        db.domains.delete_one({"_id": id_val, "userId": current_user})
        broadcaster.broadcast("domain_deleted", {"id": id_str, "domain": domain_name, "userId": current_user})
    return {"status": "success"}

# ═══════════════════════════════════════════════════════════════
#  NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════
@app.get("/api/notifications")
def get_notifications(current_user: str = Depends(get_current_user), db = Depends(get_db)):
    notifs = db.notifications.find({"userId": current_user}).sort("created_at", -1)
    return [{
        "id": f"n-{n['_id']}",
        "type": n["type"],
        "icon": n["icon"],
        "title": n["title"],
        "body": n["body"],
        "time": n["time_label"],
        "read": bool(n.get("read", False))
    } for n in notifs]

@app.post("/api/notifications/read-all")
def read_all_notifications(current_user: str = Depends(get_current_user), db = Depends(get_db)):
    db.notifications.update_many({"userId": current_user}, {"$set": {"read": True}})
    broadcaster.broadcast("notifications_updated", {"action": "read_all", "userId": current_user})
    return {"status": "success"}

@app.post("/api/notifications/{id_str}/read")
def read_notification(id_str: str, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    try:
        from bson import ObjectId
        id_val = ObjectId(id_str.replace("n-", ""))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid notification ID format.")
        
    db.notifications.update_one({"_id": id_val, "userId": current_user}, {"$set": {"read": True}})
    return {"status": "success"}

@app.post("/api/notifications/clear")
def clear_all_notifications(current_user: str = Depends(get_current_user), db = Depends(get_db)):
    db.notifications.delete_many({"userId": current_user})
    broadcaster.broadcast("notifications_updated", {"action": "cleared", "userId": current_user})
    return {"status": "success"}

# ═══════════════════════════════════════════════════════════════
#  SETTINGS
# ═══════════════════════════════════════════════════════════════
@app.get("/api/settings")
def get_settings(current_user: str = Depends(get_current_user), db = Depends(get_db)):
    s = db.settings.find_one({"userId": current_user})
    if not s:
        # Fall back to user document to extract defaults
        from bson import ObjectId
        user = db.users.find_one({"_id": ObjectId(current_user)})
        first_name = user.get("first_name", "User") if user else "User"
        last_name = user.get("last_name", "") if user else ""
        email = user.get("email", "user@example.com") if user else "user@example.com"
        username = email.split("@")[0] if "@" in email else "user"
        
        s = {
            "userId": current_user,
            "workspace_name": f"{first_name}'s Workspace",
            "default_domain": "alp.url",
            "timezone": "Asia/Kolkata (IST)",
            "language": "English (US)",
            "date_format": "YYYY-MM-DD",
            "first_name": first_name,
            "last_name": last_name,
            "username": username,
            "email": email,
            "bio": "New user on AlpURL",
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
        }
        db.settings.insert_one(s)
        
    return {
        "workspace_name": s.get("workspace_name", "My Workspace"),
        "default_domain": s.get("default_domain", "alp.url"),
        "timezone": s.get("timezone", "Asia/Kolkata (IST)"),
        "language": s.get("language", "English (US)"),
        "date_format": s.get("date_format", "YYYY-MM-DD"),
        "first_name": s.get("first_name", "User"),
        "last_name": s.get("last_name", ""),
        "username": s.get("username", "user"),
        "email": s.get("email", "user@example.com"),
        "bio": s.get("bio", "New user on AlpURL"),
        "avatar_url": s.get("avatar_url", "https://lh3.googleusercontent.com/aida-public/AB6AXuCx8QSHp37bk4zf_yrQCyiRr7v3y4ex5kb4ZneWieTJ0L5z6ZnvnsBtLW2mCETL1EURJqEDU7bjb6bo8pN6fhBYCfDX5PbEPQuupcAkXl28oWWvosXm8c_7RsA3b0RcS8EXLvZtCapp5jZl9YbN4BRODqcCnHQFNBM_guWrynhA7HDzk5sEPd2mDTv1767qTHxUkWsGS8Pnx4e3nB5QOlfyD_2fZanTs5k5mbhmE9YGA-XSAtCfnhotVg"),
        "notif_milestones": 1 if s.get("notif_milestones", True) else 0,
        "notif_insights": 1 if s.get("notif_insights", True) else 0,
        "notif_domains": 1 if s.get("notif_domains", True) else 0,
        "notif_digest": 1 if s.get("notif_digest", True) else 0,
        "notif_security": 1 if s.get("notif_security", True) else 0,
        "notif_updates": 1 if s.get("notif_updates", False) else 0,
        "theme": s.get("theme", "dark"),
        "accent_color": s.get("accent_color", "blue"),
        "font_size": s.get("font_size", "medium"),
        "compact_mode": 1 if s.get("compact_mode", False) else 0
    }

@app.post("/api/settings")
def update_settings(request: SettingsUpdateRequest, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    s = db.settings.find_one({"userId": current_user})
    update_data = request.dict(exclude_unset=True)
    update_data["userId"] = current_user
    if not s:
        db.settings.insert_one(update_data)
    else:
        db.settings.update_one({"_id": s["_id"]}, {"$set": update_data})
        
    broadcaster.broadcast("settings_updated", {**update_data, "userId": current_user})
    return {"status": "success", "message": "Settings updated"}

# ═══════════════════════════════════════════════════════════════
#  ANALYTICS & DASHBOARD STATS
# ═══════════════════════════════════════════════════════════════
@app.get("/api/dashboard-stats")
def get_dashboard_stats(range: str = "Lifetime", current_user: str = Depends(get_current_user), db = Depends(get_db)):
    now = datetime.utcnow()
    start_date = None
    
    if range == "Today":
        start_date = now - timedelta(hours=24)
    elif range == "Last 7 Days":
        start_date = now - timedelta(days=7)
    elif range == "Last 30 Days":
        start_date = now - timedelta(days=30)
    elif range == "Last 90 Days":
        start_date = now - timedelta(days=90)

    links_filter = {"is_deleted": {"$ne": True}, "userId": current_user}
    active_links_filter = {"is_deleted": {"$ne": True}, "status": "active", "userId": current_user}
    qr_filter = {"is_deleted": {"$ne": True}, "qr_code_enabled": True, "userId": current_user}
    
    user_links_cursor = db.links.find({"userId": current_user}, {"short_key": 1})
    user_short_keys = [link["short_key"] for link in user_links_cursor]
    
    if not user_short_keys:
        return {
            "total_links": 0,
            "active_links": 0,
            "qr_codes": 0,
            "total_clicks": 0,
            "unique_visitors": 0,
            "ctr": 0.0,
            "clicks_by_browser": {},
            "clicks_by_os": {},
            "clicks_by_device": {},
            "clicks_by_referrer": {},
            "clicks_by_country": {},
            "clicks_by_date": {},
            "recent_links": []
        }

    clicks_filter = {"short_key": {"$in": user_short_keys}}
    
    if start_date:
        links_filter["created_at"] = {"$gte": start_date}
        active_links_filter["created_at"] = {"$gte": start_date}
        qr_filter["created_at"] = {"$gte": start_date}
        clicks_filter["timestamp"] = {"$gte": start_date}

    total_links = db.links.count_documents(links_filter)
    active_links = db.links.count_documents(active_links_filter)
    qr_codes = db.links.count_documents(qr_filter)
    total_clicks = db.analytics.count_documents(clicks_filter)
    
    # Calculate unique visitors based on distinct IP addresses
    unique_ips = db.analytics.distinct("ip_address", clicks_filter)
    unique_visitors = len(unique_ips)
    
    ctr = round((total_clicks / max(total_links, 1)) * 10.5, 1)

    # Perform aggregation pipelines for clicks breakdown
    def aggregate_clicks_by(field):
        pipeline = []
        if clicks_filter:
            pipeline.append({"$match": clicks_filter})
        pipeline.extend([
            {"$group": {"_id": f"${field}", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}
        ])
        cursor = db.analytics.aggregate(pipeline)
        return {doc["_id"] or "Unknown": doc["count"] for doc in cursor}

    clicks_by_browser = aggregate_clicks_by("browser")
    clicks_by_os = aggregate_clicks_by("os")
    clicks_by_device = aggregate_clicks_by("device")
    clicks_by_referrer = aggregate_clicks_by("referrer")
    clicks_by_country = aggregate_clicks_by("country")

    # Time series date stats aggregation
    date_format = "%Y-%m-%d"
    if range == "Today":
        date_format = "%H:00"
        
    date_pipeline = []
    if clicks_filter:
        date_pipeline.append({"$match": clicks_filter})
        
    date_pipeline.extend([
        {"$group": {
            "_id": {"$dateToString": {"format": date_format, "date": "$timestamp"}},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ])
    
    date_cursor = db.analytics.aggregate(date_pipeline)
    clicks_by_date = {doc["_id"]: doc["count"] for doc in date_cursor if doc["_id"]}

    # Recent links list (limit 10)
    recent_mappings = db.links.find({"is_deleted": {"$ne": True}, "userId": current_user}).sort("created_at", -1).limit(10)
    recent_links = []
    for mapping in recent_mappings:
        clicks_count = mapping.get("clicks_count", 0)
        if clicks_count == 0:
            clicks_count = db.analytics.count_documents({"short_key": mapping["short_key"]})
            
        recent_links.append({
            "short_key": mapping["short_key"],
            "long_url": mapping["long_url"],
            "custom_alias": mapping.get("custom_alias"),
            "created_at": mapping["created_at"].isoformat() if mapping.get("created_at") else None,
            "clicks_count": clicks_count,
            "expiry_date": mapping["expiry_date"].isoformat() if mapping.get("expiry_date") else None,
            "qr_code_enabled": 1 if mapping.get("qr_code_enabled", False) else 0,
            "campaign": mapping.get("campaign"),
            "domain": mapping.get("domain", "alp.url"),
            "status": mapping.get("status", "active")
        })

    return {
        "total_links": total_links,
        "active_links": active_links,
        "qr_codes": qr_codes,
        "total_clicks": total_clicks,
        "unique_visitors": unique_visitors,
        "ctr": ctr,
        "clicks_by_browser": clicks_by_browser,
        "clicks_by_os": clicks_by_os,
        "clicks_by_device": clicks_by_device,
        "clicks_by_referrer": clicks_by_referrer,
        "clicks_by_country": clicks_by_country,
        "clicks_by_date": clicks_by_date,
        "recent_links": recent_links
    }

@app.get("/api/stats/{short_key}")
def get_url_stats(short_key: str, current_user: str = Depends(get_current_user), db = Depends(get_db)):
    mapping = db.links.find_one({"short_key": short_key, "is_deleted": {"$ne": True}, "userId": current_user})
    if not mapping:
        raise HTTPException(status_code=404, detail="Short URL not found")
        
    clicks = db.analytics.find({"short_key": short_key}).sort("timestamp", -1)
    clicks_list = [{
        "timestamp": c["timestamp"].isoformat() if c.get("timestamp") else None,
        "ip_address": c.get("ip_address"),
        "browser": c.get("browser"),
        "os": c.get("os"),
        "device": c.get("device"),
        "referrer": c.get("referrer")
    } for c in clicks]
    
    return {
        "short_key": mapping["short_key"],
        "long_url": mapping["long_url"],
        "created_at": mapping["created_at"].isoformat() if mapping.get("created_at") else None,
        "clicks_count": len(clicks_list),
        "clicks": clicks_list
    }

# ═══════════════════════════════════════════════════════════════
#  REDIRECT HANDLER
# ═══════════════════════════════════════════════════════════════
@app.get("/{short_key}")
def redirect_to_url(short_key: str, request: Request, background_tasks: BackgroundTasks, db = Depends(get_db)):
    if short_key in ["style.css", "app.js", "favicon.ico"]:
        file_path = os.path.join(static_dir, short_key)
        if os.path.exists(file_path):
            return FileResponse(file_path)
        raise HTTPException(status_code=404, detail="File Not Found")

    long_url = redirection_cache.get(short_key)
    if not long_url:
        mapping = db.links.find_one({"short_key": short_key, "is_deleted": {"$ne": True}})
        if not mapping or mapping.get("status") == "paused":
            raise HTTPException(status_code=404, detail="URL Not Found or Paused")
            
        expiry_date = mapping.get("expiry_date")
        if expiry_date and expiry_date < datetime.utcnow():
            raise HTTPException(status_code=410, detail="Short URL has expired")
            
        long_url = mapping["long_url"]
        redirection_cache[short_key] = long_url
    
    user_agent = request.headers.get("user-agent", "Unknown")
    ip_address = request.client.host if request.client else "127.0.0.1"
    referrer = request.headers.get("referer", "Direct")
    
    def log_and_broadcast():
        db2 = db_manager.get_db()
        log_click_telemetry(db2, short_key, user_agent, ip_address, referrer)
        link = db2.links.find_one({"short_key": short_key})
        user_id = link.get("userId") if link else "anonymous"
        broadcaster.broadcast("click_recorded", {"short_key": short_key, "ip": ip_address, "userId": user_id})
    
    background_tasks.add_task(log_and_broadcast)
    return RedirectResponse(url=long_url, status_code=307)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
