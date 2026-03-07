FROM golang:1.21-alpine AS builder

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

# 运行阶段
FROM alpine:latest

WORKDIR /app

# 安装必要的根证书（避免请求外部 API 报错）
RUN apk --no-cache add ca-certificates tzdata

# 从 builder 阶段复制编译好的执行文件
COPY --from=builder /app/edict-go .

# 声明端口
EXPOSE 8080

# 运行服务
CMD ["./edict-go"]
