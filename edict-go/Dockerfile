FROM golang:1.25-alpine AS builder

WORKDIR /app

# 设置代理，加速国内下载
ENV GOPROXY=https://goproxy.cn,direct


# 复制 go.mod 和 go.sum
COPY go.mod go.sum ./
RUN go mod download

# 复制源码
COPY . .

# 编译成可执行文件 (静态链接，缩小体积)
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o edict-go .

# 运行阶段 - 切换到 Debian 系列镜像以获得更好的工具兼容性 (glibc)
FROM python:3.11-slim-bookworm

WORKDIR /app

# 安装必要系统工具，包括 openssh-client 和构建工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    git \
    curl \
    gnupg \
    openssh-client \
    build-essential \
    && git config --global url."https://kkgithub.com/".insteadOf https://github.com/ \
    && git config --global url."https://kkgithub.com/".insteadOf git@github.com: \
    && git config --global url."https://kkgithub.com/".insteadOf ssh://git@github.com/ \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm config set registry https://mirrors.cloud.tencent.com/npm/ \
    && npm install -g openclaw@latest \
    && rm -rf /var/lib/apt/lists/*

# 从 builder 阶段复制编译好的执行文件 (静态链接的可在 debian 运行)
COPY --from=builder /app/edict-go .

# 声明端口
EXPOSE 8080

# 运行服务
CMD ["./edict-go"]
