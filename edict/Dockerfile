FROM python:3.12-slim

WORKDIR /app

# 安装系统依赖
# 1. 深度镜像劫持 (USTC) & 增加重试逻辑 (应对 security.debian.org 无法访问的问题)
RUN set -ex; \
    sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list.d/debian.sources || true; \
    sed -i 's/security.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list.d/debian.sources || true; \
    sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list || true; \
    sed -i 's/security.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list || true; \
    for i in 1 2 3; do apt-get update && break || sleep 5; done; \
    apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY edict/backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r /tmp/requirements.txt

# 复制后端代码
COPY edict/backend/ /app/

# 复制 Alembic 配置
COPY edict/alembic.ini /app/alembic.ini
COPY edict/migration/ /app/migration/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
