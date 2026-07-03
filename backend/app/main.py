import os
from datetime import datetime, timedelta
from fastapi import FastAPI, Depends, HTTPException, Request, BackgroundTasks
from fastapi.responses import RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func

from .database import init_db, get_db, SessionLocal, URLMapping, ClickTelemetry
from .schemas import URLShortenRequest, URLShortenResponse, URLStatsResponse, ClickStats
from .kgs import kgs_instance
from .telemetry import log_click_telemetry

app = FastAPI(title="Lilliput Distributed URL Shortener Reference Implementation")

# CORS middleware for local API calls if needed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory redirection cache (simulating CDNs/L2 Redis cache)
redirection_cache = {}

@app.on_event("startup")
def startup_event():
    # Initialize SQLite database
    init_db()
    
    # Warm up memory cache with top active links from the database
    db = next(get_db())
    try:
        active_mappings = db.query(URLMapping).filter(
            (URLMapping.expiry_date == None) | (URLMapping.expiry_date > datetime.utcnow())
        ).order_by(URLMapping.created_at.desc()).limit(1000).all()
        for mapping in active_mappings:
            redirection_cache[mapping.short_key] = mapping.long_url
        print(f"[Cache] rediction cache warmed up with {len(active_mappings)} items.")
    except Exception as e:
        print(f"[Cache Warning] Failed to warm up redirection cache: {e}")

# Serve frontend SPA assets
static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "frontend")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

# Endpoints

@app.post("/api/shorten", response_model=URLShortenResponse)
def shorten_url(request: URLShortenRequest, req: Request, db: Session = Depends(get_db)):
    """Shortens a long URL using the Key Generation Service or a custom alias."""
    long_url = str(request.long_url)
    
    # Clean/validate target URL prefix
    if not (long_url.startswith("http://") or long_url.startswith("https://")):
        long_url = "https://" + long_url
        
    short_key = None
    
    if request.custom_alias:
        # Verify custom alias uniqueness
        existing = db.query(URLMapping).filter(URLMapping.short_key == request.custom_alias).first()
        if existing:
            raise HTTPException(status_code=400, detail="Custom alias is already in use.")
        short_key = request.custom_alias
    else:
        # Pre-allocated unique key from KGS
        short_key = kgs_instance.get_next_key()
        
    # Expiry calculation
    expiry_date = None
    if request.expiry_hours:
        expiry_date = datetime.utcnow() + timedelta(hours=request.expiry_hours)
    else:
        # Default TTL of 2 years to protect storage bounds (Assumption Q2)
        expiry_date = datetime.utcnow() + timedelta(days=365 * 2)

    # Save to Database
    db_mapping = URLMapping(
        short_key=short_key,
        long_url=long_url,
        custom_alias=request.custom_alias,
        expiry_date=expiry_date
    )
    db.add(db_mapping)
    db.commit()
    db.refresh(db_mapping)
    
    # Cache mapping in memory immediately
    redirection_cache[short_key] = long_url
    
    # Construct absolute short URL
    base_url = str(req.base_url)
    short_url = f"{base_url}{short_key}"
    
    return URLShortenResponse(
        short_key=short_key,
        short_url=short_url,
        long_url=long_url,
        created_at=db_mapping.created_at,
        expiry_date=expiry_date
    )

@app.get("/api/dashboard-stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    """Retrieves analytical statistics and trends for the global dashboard."""
    # Count totals
    total_links = db.query(URLMapping).count()
    total_clicks = db.query(ClickTelemetry).count()
    
    # Clicks by browser
    browser_stats = db.query(
        ClickTelemetry.browser, func.count(ClickTelemetry.id)
    ).group_by(ClickTelemetry.browser).all()
    clicks_by_browser = {b or "Unknown": count for b, count in browser_stats}
    
    # Clicks by OS
    os_stats = db.query(
        ClickTelemetry.os, func.count(ClickTelemetry.id)
    ).group_by(ClickTelemetry.os).all()
    clicks_by_os = {o or "Unknown": count for o, count in os_stats}

    # Clicks by device
    device_stats = db.query(
        ClickTelemetry.device, func.count(ClickTelemetry.id)
    ).group_by(ClickTelemetry.device).all()
    clicks_by_device = {d or "Unknown": count for d, count in device_stats}
    
    # Clicks by referrer
    referrer_stats = db.query(
        ClickTelemetry.referrer, func.count(ClickTelemetry.id)
    ).group_by(ClickTelemetry.referrer).all()
    clicks_by_referrer = {r or "Direct": count for r, count in referrer_stats}

    # Clicks by date (last 7 days)
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    date_stats = db.query(
        func.date(ClickTelemetry.timestamp).label("date"),
        func.count(ClickTelemetry.id).label("count")
    ).filter(ClickTelemetry.timestamp >= seven_days_ago).group_by(func.date(ClickTelemetry.timestamp)).all()
    clicks_by_date = {str(d.date): d.count for d in date_stats}

    # Recent links
    recent_mappings = db.query(URLMapping).order_by(URLMapping.created_at.desc()).limit(10).all()
    recent_links = []
    for mapping in recent_mappings:
        # Get count of clicks for each
        clicks_count = db.query(ClickTelemetry).filter(ClickTelemetry.short_key == mapping.short_key).count()
        recent_links.append({
            "short_key": mapping.short_key,
            "long_url": mapping.long_url,
            "custom_alias": mapping.custom_alias,
            "created_at": mapping.created_at,
            "clicks_count": clicks_count,
            "expiry_date": mapping.expiry_date
        })

    return {
        "total_links": total_links,
        "total_clicks": total_clicks,
        "clicks_by_browser": clicks_by_browser,
        "clicks_by_os": clicks_by_os,
        "clicks_by_device": clicks_by_device,
        "clicks_by_referrer": clicks_by_referrer,
        "clicks_by_date": clicks_by_date,
        "recent_links": recent_links
    }

@app.get("/api/stats/{short_key}", response_model=URLStatsResponse)
def get_url_stats(short_key: str, db: Session = Depends(get_db)):
    """Fetches full click logs and telemetry details for a specific key."""
    mapping = db.query(URLMapping).filter(URLMapping.short_key == short_key).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Short URL not found")
        
    clicks = db.query(ClickTelemetry).filter(ClickTelemetry.short_key == short_key).order_by(ClickTelemetry.timestamp.desc()).all()
    
    # Cast sqlalchemy model list to Pydantic model representation
    clicks_list = [
        ClickStats(
            timestamp=c.timestamp,
            ip_address=c.ip_address,
            browser=c.browser,
            os=c.os,
            device=c.device,
            referrer=c.referrer
        ) for c in clicks
    ]
    
    return URLStatsResponse(
        short_key=mapping.short_key,
        long_url=mapping.long_url,
        created_at=mapping.created_at,
        clicks_count=len(clicks_list),
        clicks=clicks_list
    )

@app.get("/{short_key}")
def redirect_to_url(short_key: str, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """High-speed redirection handler that caches mappings and processes logs asynchronously."""
    # Intercept static files that conflict with the wildcard route
    if short_key in ["style.css", "app.js", "favicon.ico"]:
        file_path = os.path.join(static_dir, short_key)
        if os.path.exists(file_path):
            return FileResponse(file_path)
        raise HTTPException(status_code=404, detail="File Not Found")

    # Check cache first for < 5ms redirect retrieval
    long_url = redirection_cache.get(short_key)
    
    if not long_url:
        # Cache miss: Query Database
        mapping = db.query(URLMapping).filter(URLMapping.short_key == short_key).first()
        if not mapping:
            raise HTTPException(status_code=404, detail="URL Not Found")
            
        # Check Expiry
        if mapping.expiry_date and mapping.expiry_date < datetime.utcnow():
            raise HTTPException(status_code=410, detail="Short URL has expired")
            
        long_url = mapping.long_url
        # Save to local cache
        redirection_cache[short_key] = long_url
    
    # Extract client request details
    user_agent = request.headers.get("user-agent", "Unknown")
    ip_address = request.client.host if request.client else "127.0.0.1"
    referrer = request.headers.get("referer", "Direct")
    
    # Queue analytical telemetry logging asynchronously to prevent latency spikes
    # Uses FastAPI background worker context (decoupled processing)
    background_tasks.add_task(
        log_click_telemetry,
        SessionLocal(), # Independent DB session for background thread safety
        short_key,
        user_agent,
        ip_address,
        referrer
    )
    
    # Perform instant redirect
    return RedirectResponse(url=long_url, status_code=307)

# Serve SPA static files
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
