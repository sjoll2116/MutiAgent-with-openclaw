import os
import httpx
import argparse
import sys
from typing import Optional

# 默认配置
DEFAULT_URL = "http://localhost:8000/api/rag/documents/{doc_id}/hard"
DEFAULT_TOKEN = "0a7f3132c662cd8327e190f3f77681c689ca2ede7de8756f"

async def delete_document(
    doc_id: str, 
    base_url: str = "http://localhost:8000", 
    token: str = DEFAULT_TOKEN
):
    """通过 API 从 RAG 知识库彻底(硬)删除文档。"""
    
    print(f"🚀 正在删除文档: {doc_id} ...")
    api_url = f"{base_url}/api/rag/documents/{doc_id}/hard"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            headers = {"X-Service-Token": token}
            response = await client.delete(api_url, headers=headers)
            
            response.raise_for_status()
            result = response.json()
            
            print(f"✅ 删除成功！")
            print(f"   状态: {result.get('status')}")
            print(f"   消息: {result.get('message')}")

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                print(f"❌ 找不到该文档，或者它已经被删除了。")
            else:
                print(f"❌ 删除失败 (HTTP {e.response.status_code}): {e.response.text}")
        except Exception as e:
            print(f"❌ 发生错误: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Edict RAG 自动删除脚本 (硬删除)")
    parser.add_argument("doc_id", help="要删除的文档 ID (Doc ID)")
    parser.add_argument("--url", default="http://localhost:8000", help="后端基础 URL (默认: http://localhost:8000)")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="Service Token")

    args = parser.parse_args()

    import asyncio
    asyncio.run(delete_document(
        args.doc_id, 
        base_url=args.url, 
        token=args.token
    ))
