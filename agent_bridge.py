import os
import json
import time
import subprocess

REQUEST_FILE = os.path.join(".agents", "cmd_request.json")
RESPONSE_FILE = os.path.join(".agents", "cmd_response.json")

def main():
    print("Agent Bridge started. Waiting for commands from the Sandbox...")
    os.makedirs(".agents", exist_ok=True)
    
    # Initialize request file if it doesn't exist
    if not os.path.exists(REQUEST_FILE):
        with open(REQUEST_FILE, "w", encoding="utf-8") as f:
            json.dump({"id": 0, "command": ""}, f)
            
    last_id = 0
    
    while True:
        try:
            time.sleep(1.0) # Check every second
            
            with open(REQUEST_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                
            current_id = data.get("id", 0)
            command = data.get("command", "")
            
            if current_id > last_id and command:
                print(f"\n[Sandbox Agent] Executing: {command}")
                try:
                    result = subprocess.run(
                        command, 
                        shell=True, 
                        capture_output=True, 
                        text=True,
                        cwd=os.getcwd()
                    )
                    response = {
                        "id": current_id,
                        "stdout": result.stdout,
                        "stderr": result.stderr,
                        "returncode": result.returncode
                    }
                except Exception as e:
                    response = {
                        "id": current_id,
                        "stdout": "",
                        "stderr": str(e),
                        "returncode": -1
                    }
                    
                with open(RESPONSE_FILE, "w", encoding="utf-8") as f:
                    json.dump(response, f, indent=2)
                    
                print(f"[Bridge] Command finished with exit code {response['returncode']}")
                last_id = current_id
                
        except (json.JSONDecodeError, FileNotFoundError):
            pass
        except KeyboardInterrupt:
            print("\nBridge stopped.")
            break

if __name__ == "__main__":
    main()
