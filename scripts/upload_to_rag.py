import os
import httpx
import argparse
import sys
from typing import Optional

# 默认配置
DEFAULT_URL = "http://localhost:8000/api/rag/ingest-file"
DEFAULT_TOKEN = "edict-internal-service-token-2026"

async def upload_file(
    file_path: str, 
    api_url: str = DEFAULT_URL, 
    token: str = DEFAULT_TOKEN, 
    project_id: str = "", 
    is_temporary: bool = False
):
    """通过 API 上传文件到 RAG 知识库。"""
    
    if not os.path.exists(file_path):
        print(f"❌ 错误: 文件不存在 -> {file_path}")
        return

    file_name = os.path.basename(file_path)
    print(f"🚀 正在上传: {file_name} ...")

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            with open(file_path, "rb") as f:
                files = {"file": (file_name, f)}
                data = {
                    "project_id": project_id,
                    "is_temporary": str(is_temporary).lower()
                }
                headers = {"X-Service-Token": token}

                response = await client.post(
                    api_url, 
                    files=files, 
                    data=data, 
                    headers=headers
                )
                
                response.raise_for_status()
                result = response.json()
                
                print(f"✅ 上传成功！")
                print(f"   状态: {result.get('status')}")
                print(f"   消息: {result.get('message')}")
                print(f"   Doc ID: {result.get('doc_id')}")
                print(f"\n💡 提示: 上传任务正在后台异步处理，请稍后查询切片内容。")

        except httpx.HTTPStatusError as e:
            print(f"❌ 上传失败 (HTTP {e.response.status_code}): {e.response.text}")
        except Exception as e:
            print(f"❌ 发生错误: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Edict RAG 自动上传脚本")
    parser.add_argument("file", help="要上传的本地文件路径")
    parser.add_argument("--project", default="general", help="项目 ID (用于分类知识库)")
    parser.add_argument("--url", default=DEFAULT_URL, help=f"API 地址 (默认: {DEFAULT_URL})")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="Service Token")
    parser.add_argument("--temp", action="store_true", help="是否标记为临时文件 (24小时后自动清理)")

    args = parser.parse_args()

    import asyncio
    asyncio.run(upload_file(
        args.file, 
        api_url=args.url, 
        token=args.token, 
        project_id=args.project, 
        is_temporary=args.temp
    ))
