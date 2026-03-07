#!/usr/bin/env python3
"""
Web Search Tool for OpenClaw Agents (Powered by Tavily).
Usage: python3 search_web.py "your search query"
"""
import sys
import os
import json
import httpx

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

async def search_tavily(query: str, search_depth: str = "smart", max_results: int = 5):
    """Executes a web search via Tavily API."""
    if not TAVILY_API_KEY:
        return "错误：未发现 TAVILY_API_KEY。请在 .env 文件中配置。"

    url = "https://api.tavily.com/search"
    payload = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "search_depth": search_depth,
        "include_answer": True,
        "max_results": max_results
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=20.0)
            response.raise_for_status()
            data = response.json()
            
            output = []
            if data.get("answer"):
                output.append(f"--- AI 简评 ---\n{data['answer']}\n")
            
            output.append(f"--- 搜索结果 (Top {len(data.get('results', []))}) ---")
            for i, res in enumerate(data.get("results", []), 1):
                output.append(f"\n[{i}] {res['title']}\nURL: {res['url']}\n摘要: {res['content'][:300]}...")
            
            return "\n".join(output)
    except Exception as e:
        return f"网络搜索执行失败: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 search_web.py '<query>'")
        sys.exit(1)
        
    import asyncio
    query_input = " ".join(sys.argv[1:])
    result = asyncio.run(search_tavily(query_input))
    print(result)
