import os
import json
import argparse
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 数据库连接配置
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://edict:edict_secret_change_me@localhost:5432/edict")

def get_engine():
    try:
        return create_async_engine(DATABASE_URL)
    except Exception as e:
        print(f"❌ 无法连接数据库: {e}")
        return None

async def list_recent_documents(limit=10):
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

async def inspect_hierarchy(doc_id=None, limit=100):
    """层级化展示切片内容，清晰看到 Parent-Child 关系。"""
    engine = get_engine()
    if not engine: return
    
    # 检索逻辑：先按 doc_id 分组，再按 Parent 排序，子块紧跟父块
    if doc_id:
        print(f"\n🔍 正在深度检视文档 [{doc_id}] 的层级结构...")
        query = text("""
            SELECT id, content, parent_id, metadata_json
            FROM document_chunks
            WHERE doc_id = :doc_id
            ORDER BY COALESCE(parent_id, id), parent_id IS NOT NULL, id
            LIMIT :limit
        """)
        params = {"doc_id": doc_id, "limit": limit}
    else:
        print(f"\n🌍 正在检视全量层级结构 (前 {limit} 条)...")
        query = text("""
            SELECT id, doc_id, content, parent_id, metadata_json
            FROM document_chunks
            ORDER BY doc_id, COALESCE(parent_id, id), parent_id IS NOT NULL, id
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

        current_doc = None
        for row in rows:
            # 打印文档分割线
            if not doc_id and row.doc_id != current_doc:
                current_doc = row.doc_id
                print(f"\n\n{'='*20} Document: {current_doc} {'='*20}")

            is_child = row.parent_id is not None
            
            if not is_child:
                # Parent 样式：深红色背景或醒目边框 (模拟)
                print(f"\n\033[1;34m[PARENT] ID: {row.id}\033[0m")
                content = row.content.replace("\n", " ")
                print(f"   | {content[:300]}...")
            else:
                # Child 样式：缩进并弱化
                print(f"   \033[2m└── [CHILD] ID: {row.id} (Parent: {row.parent_id})\033[0m")
                content = row.content.replace("\n", " ")
                print(f"       > {content[:150]}...")
    
    print(f"\n💡 提示：以上内容仅为预览。Parent 块通常为 1024 字符，用于 LLM 阅读；Child 块为 256 字符，用于精准检索。")
    await engine.dispose()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Edict RAG 增强型层级化切片检视工具")
    parser.add_argument("--doc-id", help="查看特定文档的切片结构")
    parser.add_argument("--list", action="store_true", help="列出最近文档")
    parser.add_argument("--limit", type=int, default=100, help="限制显示数量")

    args = parser.parse_args()

    async def main():
        if args.list:
            await list_recent_documents(args.limit)
        else:
            await inspect_hierarchy(args.doc_id, args.limit)
            
    asyncio.run(main())
