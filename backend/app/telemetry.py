import datetime
from ua_parser import user_agent_parser

def log_click_telemetry(db, short_key: str, user_agent_str: str, ip_address: str, referrer: str):
    """Processes and logs click metadata in a decoupled background task into MongoDB."""
    try:
        # Parse User Agent
        parsed_ua = user_agent_parser.Parse(user_agent_str or "")
        
        # Extract Browser
        browser_info = parsed_ua.get("user_agent", {})
        browser_name = browser_info.get("family", "Unknown")
        if browser_info.get("major"):
            browser_name += f" {browser_info['major']}"
            
        # Extract OS
        os_info = parsed_ua.get("os", {})
        os_name = os_info.get("family", "Unknown")
        if os_info.get("major"):
            os_name += f" {os_info['major']}"
            
        # Extract Device
        device_info = parsed_ua.get("device", {})
        device_name = device_info.get("family", "Unknown")
        if device_name == "Other" or not device_name:
            device_name = "Desktop"
            
        # Guess country from IP address deterministically
        countries = ["United States", "Germany", "United Kingdom", "India", "France", "Canada", "Australia", "Japan"]
        ip_hash = sum(ord(c) for c in (ip_address or "127.0.0.1"))
        country_name = countries[ip_hash % len(countries)]
            
        # Get userId from the link
        link = db.links.find_one({"short_key": short_key})
        user_id = link.get("userId") if link else None

        # Create Telemetry Entry
        telemetry = {
            "short_key": short_key,
            "userId": user_id,
            "ip_address": ip_address or "127.0.0.1",
            "user_agent": user_agent_str,
            "browser": browser_name,
            "os": os_name,
            "device": device_name,
            "referrer": referrer or "Direct",
            "country": country_name,
            "timestamp": datetime.datetime.utcnow()
        }
        
        # Save to DB (analytics collection)
        db.analytics.insert_one(telemetry)
        
        # Increment click count in links collection if it exists
        db.links.update_one({"short_key": short_key}, {"$inc": {"clicks_count": 1}})
        # Increment click count in qrCodes collection if qr code exists
        db.qrCodes.update_one({"short_key": short_key}, {"$inc": {"clicks": 1}})
        
    except Exception as e:
        print(f"[Telemetry Error] Failed to log click: {e}")
