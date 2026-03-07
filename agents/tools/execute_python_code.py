#!/usr/bin/env python3
"""
为 OpenClaw Agent 提供的 Python 代码沙盒执行工具。
用法: python3 execute_python_code.py "您的 python 代码"

该工具在临时子进程中运行提供的 Python 代码，
并捕获返回的 stdout 和 stderr。
"""
import sys
import subprocess
import tempfile
import textwrap

def execute_code(code: str, timeout: int = 15):
    """在临时文件中执行 python 代码并捕获输出。"""
    # 注意：为了生产环境的真实安全，这应该在受限的 Docker 容器或 gVisor 沙盒中运行。
    # 这里我们使用基础的子进程进行演示。
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as tmp:
        tmp.write(code)
        tmp_path = tmp.name

    print("--- 执行结果 ---")
    try:
        # 运行临时 Python 脚本
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        if result.stdout:
            print("[标准输出 STDOUT]")
            print(result.stdout)
            
        if result.stderr:
            print("[标准错误 STDERR]")
            print(result.stderr)
            
        if result.returncode == 0:
            print(f"\n✅ 执行成功 (返回码: 0)")
        else:
            print(f"\n❌ 执行失败 (返回码: {result.returncode})")
            
    except subprocess.TimeoutExpired:
        print(f"❌ 执行超时，超过了 {timeout} 秒限制。")
    except Exception as e:
        print(f"❌ 无法执行代码: {e}")
    finally:
        import os
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 execute_python_code.py '<code>'")
        sys.exit(1)
        
    code_input = sys.argv[1]
    
    # 如果 Agent 包含了 markdown 代码块语法，尝试进行清理
    if code_input.startswith("```"):
        lines = code_input.split('\n')
        if len(lines) > 1:
            # 移除第一行 (例如 ```python) 和最后一行 (```)
            code_input = '\n'.join(lines[1:-1])

    code_input = textwrap.dedent(code_input)
    execute_code(code_input)
