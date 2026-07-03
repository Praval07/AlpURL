from ua_parser import user_agent_parser
from sqlalchemy.orm import Session
from .database import ClickTelemetry

def log_click_telemetry(db: Session, short_key: str, user_agent_str: str, ip_address: str, referrer: str):
    """Processes and logs click metadata in a decoupled background task."""
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
            
        # Create Telemetry Entry
        telemetry = ClickTelemetry(
            short_key=short_key,
            ip_address=ip_address or "127.0.0.1",
            user_agent=user_agent_str,
            browser=browser_name,
            os=os_name,
            device=device_name,
            referrer=referrer or "Direct"
        )
        
        # Save to DB
        db.add(telemetry)
        db.commit()
    except Exception as e:
        print(f"[Telemetry Error] Failed to log click: {e}")
        db.rollback()
