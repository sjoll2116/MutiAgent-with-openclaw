import os
import json
import argparse
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 数据库连接配置 (使用 asyncpg)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://edict:edict_secret_change_me@localhost:5432/edict")

def get_engine():
    """获取 SQLAlchemy 异步引擎。"""
    try:
        return create_async_engine(DATABASE_URL)
    except Exception as e:
        print(f"❌ 无法连接数据库: {e}")
        return None

async def list_recent_documents(limit=10):
    """异步列出最近上传的文档。"""
    engine = get_engine()
    if not engine: return
    
    query = text("""
        SELECT doc_id, file_name, file_type, created_at, source_agent
        FROM documents
        WHERE is_deleted = false
        ORDER BY created_at DESC
        LIMIT :limit
    """)
    
    async with engine.connect() as conn:
        result = await conn.execute(query, {"limit": limit})
        rows = result.fetchall()
        print(f"\n--- 📋 最近上传的 {limit} 份文档 ---")
        print(f"{'Doc ID':<25} | {'Filename':<30} | {'Type':<10} | {'Created At'}")
        print("-" * 85)
        for row in rows:
            print(f"{row.doc_id:<25} | {row.file_name[:30]:<30} | {row.file_type:<10} | {row.created_at}")
        print("-" * 85)
    
    await engine.dispose()

async def inspect_chunks(doc_id=None, limit=50):
    """异步直观查看切片内容。"""
    engine = get_engine()
    if not engine: return
    
    if doc_id:
        print(f"\n🔍 正在检索文档 [{doc_id}] 的切片...")
        query = text("""
            SELECT id, content, metadata_json, parent_id
            FROM document_chunks
            WHERE doc_id = :doc_id
            ORDER BY id ASC
            LIMIT :limit
        """)
        params = {"doc_id": doc_id, "limit": limit}
    else:
        print(f"\n🌍 正在检索全量切片 (前 {limit} 条)...")
        query = text("""
            SELECT id, doc_id, content, metadata_json, parent_id
            FROM document_chunks
            ORDER BY doc_id, id ASC
            LIMIT :limit
        """)
        params = {"limit": limit}

    async with engine.connect() as conn:
        result = await conn.execute(query, params)
        rows = result.fetchall()
        
        if not rows:
            print("📭 未找到任何切片内容。")
            await engine.dispose()
            return

        for row in rows:
            meta = json.loads(row.metadata_json) if row.metadata_json else {}
            path = meta.get("section_path", "Root")
            is_child = row.parent_id is not None
            
            # 视觉样式增强
            prefix = "   └── [Child]" if is_child else "📂 [Parent]"
            color_prefix = "\033[94m" if not is_child else "\033[92m" # 蓝色 Parent, 绿色 Child
            reset = "\033[0m"
            
            print(f"\n{color_prefix}{prefix} ID: {row.id} | Path: {path}{reset}")
            if not doc_id:
                print(f"   Document: {row.doc_id}")
            
            # 打印内容预览 (换行处理)
            content_display = row.content.strip()
            print(f"   Content: {content_display[:200]}..." if len(content_display) > 200 else f"   Content: {content_display}")
            print("-" * 40)
    
    await engine.dispose()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Edict RAG 切片内容直观检视工具")
    parser.add_argument("--doc-id", help="查看特定文档的切片 (不填则列出全量)")
    parser.add_argument("--list", action="store_true", help="列出最近上传的文档清单")
    parser.add_argument("--limit", type=int, default=50, help="显示数量限制 (默认 50)")

    args = parser.parse_args()

    async def main():
        if args.list:
            await list_recent_documents(args.limit)
        else:
            await inspect_chunks(args.doc_id, args.limit)
            
    asyncio.run(main())
