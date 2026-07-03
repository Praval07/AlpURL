import sys
import os

# Add workspace root to system path to resolve backend imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app.main import app
