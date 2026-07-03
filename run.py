import os
import sys
import subprocess

def run_cmd(args, cwd=None):
    print(f"Running: {' '.join(args)}")
    return subprocess.run(args, cwd=cwd, check=True)

def main():
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 1. Virtual Environment Setup
    venv_dir = os.path.join(workspace_dir, ".venv")
    python_exe = sys.executable
    
    if not os.path.exists(venv_dir):
        print(f"Creating virtual environment in: {venv_dir}...")
        run_cmd([python_exe, "-m", "venv", ".venv"], cwd=workspace_dir)
    
    # Identify venv python and pip paths
    if sys.platform == "win32":
        venv_python = os.path.join(venv_dir, "Scripts", "python.exe")
        venv_pip = os.path.join(venv_dir, "Scripts", "pip.exe")
    else:
        venv_python = os.path.join(venv_dir, "bin", "python")
        venv_pip = os.path.join(venv_dir, "bin", "pip")
        
    # 2. Dependency Check & Installation
    print("Installing requirements from backend/requirements.txt...")
    run_cmd([venv_pip, "install", "-r", "backend/requirements.txt"], cwd=workspace_dir)
    
    # 3. Launching Application
    print("\n" + "="*50)
    print("  AlpURL AI-Powered Distributed URL Management Platform")
    print("  Running on: http://localhost:8000")
    print("="*50 + "\n")
    
    # Use uvicorn module from virtual environment to start app
    try:
        run_cmd([
            venv_python, 
            "-m", "uvicorn", 
            "backend.app.main:app", 
            "--host", "127.0.0.1", 
            "--port", "8000",
            "--reload"
        ], cwd=workspace_dir)
    except KeyboardInterrupt:
        print("\nShutting down Lilliput server gracefully...")

if __name__ == "__main__":
    main()
