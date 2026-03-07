#!/usr/bin/env python3
"""
Execute Python Code Sandbox Tool for OpenClaw Agents.
Usage: python3 execute_python_code.py "your python code here"

This tool runs the provided Python code in a temporary subprocess
and returns the captured stdout and stderr.
"""
import sys
import subprocess
import tempfile
import textwrap

def execute_code(code: str, timeout: int = 15):
    """Executes python code in a temporary file and captures the output."""
    # Note: For genuine production security, this should run inside a restricted Docker
    # container or gVisor sandbox. Here we use a basic subprocess for demonstration.
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as tmp:
        tmp.write(code)
        tmp_path = tmp.name

    print("--- Execution Results ---")
    try:
        # Run the temporary Python script
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        if result.stdout:
            print("[STDOUT]")
            print(result.stdout)
            
        if result.stderr:
            print("[STDERR]")
            print(result.stderr)
            
        if result.returncode == 0:
            print(f"\n✅ Execution completed successfully (Return Code: 0)")
        else:
            print(f"\n❌ Execution failed (Return Code: {result.returncode})")
            
    except subprocess.TimeoutExpired:
        print(f"❌ Execution timed out after {timeout} seconds.")
    except Exception as e:
        print(f"❌ Failed to execute code: {e}")
    finally:
        import os
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 execute_python_code.py '<code>'")
        sys.exit(1)
        
    code_input = sys.argv[1]
    
    # Try to clean up markdown code block syntax if the agent included it
    if code_input.startswith("```"):
        lines = code_input.split('\n')
        if len(lines) > 1:
            # Remove the first line (e.g., ```python) and the last line (```)
            code_input = '\n'.join(lines[1:-1])

    code_input = textwrap.dedent(code_input)
    execute_code(code_input)
