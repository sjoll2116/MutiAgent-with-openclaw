#!/usr/bin/env python3
"""
Search Knowledge Base Tool for OpenClaw Agents.
Usage: python3 search_knowledge.py "your query here"
"""
import sys
import json
import urllib.request
import urllib.parse
from pathlib import Path

# Adjust API URL if calling from within the docker network
API_URL = "http://backend:8000/api/rag/search"

def search(query: str, top_k: int = 5):
    data = json.dumps({"query": query, "top_k": top_k, "use_hyde": True}).encode('utf-8')
    req = urllib.request.Request(
        API_URL, 
        data=data, 
        headers={'Content-Type': 'application/json'}
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            
            if result.get("status") == "success":
                chunks = result.get("data", [])
                if not chunks:
                    print("No relevant knowledge found.")
                    return
                
                print(f"--- Top {len(chunks)} Knowledge Base Results ---")
                for i, chunk in enumerate(chunks, 1):
                    doc_id = chunk.get("doc_id", "Unknown")
                    score = chunk.get("score", 0.0)
                    content = chunk.get("content", "")
                    print(f"\n[{i}] Source: {doc_id} (Score: {score:.3f})")
                    print(f"{content}\n" + "-"*40)
            else:
                print(f"Error: {result}")
    except Exception as e:
        print(f"Failed to query knowledge base: {e}")
        # Add fallback to try localhost if 'backend' hostname is unresolvable
        if "backend:8000" in API_URL:
            print("Retrying on localhost:8000...")
            _fallback_search(query, top_k)

def _fallback_search(query: str, top_k: int):
    fallback_url = "http://localhost:8000/api/rag/search"
    data = json.dumps({"query": query, "top_k": top_k, "use_hyde": True}).encode('utf-8')
    req = urllib.request.Request(
        fallback_url, 
        data=data, 
        headers={'Content-Type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req) as response:
            result = json.loads(response.read().decode('utf-8'))
            if result.get("status") == "success":
                chunks = result.get("data", [])
                for i, chunk in enumerate(chunks, 1):
                    print(f"\n[{i}] Source: {chunk.get('doc_id')} ({chunk.get('score'):.3f})")
                    print(chunk.get('content'))
            else:
                print(f"Error: {result}")
    except Exception as e:
         print(f"Fallback Failed: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 search_knowledge.py <query>")
        sys.exit(1)
        
    query = " ".join(sys.argv[1:])
    search(query)
