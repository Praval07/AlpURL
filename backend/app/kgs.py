import threading
import string

# Base62 character set
BASE62_CHARS = string.digits + string.ascii_lowercase + string.ascii_uppercase

def encode_base62(num: int) -> str:
    """Encodes an integer into a Base62 string."""
    if num == 0:
        return BASE62_CHARS[0]
    arr = []
    base = len(BASE62_CHARS)
    while num:
        num, rem = divmod(num, base)
        arr.append(BASE62_CHARS[rem])
    arr.reverse()
    return ''.join(arr)

class KeyGenerationService:
    def __init__(self, db_path="kgs_state.txt", block_size=1000):
        import os
        # On Vercel (or other AWS Lambda environments), use /tmp as the writable storage directory
        if os.getenv("VERCEL") == "1" or "AWS_LAMBDA_FUNCTION_NAME" in os.environ:
            db_path = "/tmp/kgs_state.txt"
            
        self.db_path = db_path
        self.block_size = block_size
        self.lock = threading.Lock()
        
        # Load last counter or initialize
        self.current_counter = 0
        self.max_counter = 0
        self._load_state()

    def _load_state(self):
        """Loads counter state and pre-allocates the first block."""
        try:
            with open(self.db_path, "r") as f:
                content = f.read().strip()
                if content:
                    # Last saved counter is the maximum allocated so far
                    last_allocated = int(content)
                    self.current_counter = last_allocated
                    self.max_counter = last_allocated
                else:
                    self._allocate_new_block()
        except FileNotFoundError:
            self._allocate_new_block()

    def _allocate_new_block(self):
        """Pre-allocates a block of keys by updating the persistent state."""
        # Start counter from 100000 to get clean 6-character/5-character strings
        start = max(self.max_counter, 100000)
        self.current_counter = start
        self.max_counter = start + self.block_size
        
        # Persist the end of the new block
        with open(self.db_path, "w") as f:
            f.write(str(self.max_counter))
        print(f"[KGS] Allocated new block of keys: {self.current_counter} to {self.max_counter}")

    def get_next_key(self) -> str:
        """Thread-safe method to retrieve the next unique Base62 key."""
        with self.lock:
            if self.current_counter >= self.max_counter:
                self._allocate_new_block()
            
            counter_val = self.current_counter
            self.current_counter += 1
            
            # Encode counter to Base62
            key = encode_base62(counter_val)
            
            # Standardize length to 6 characters (pad with zeros if necessary)
            return key.zfill(6)

# Global KGS Instance
kgs_instance = KeyGenerationService()
