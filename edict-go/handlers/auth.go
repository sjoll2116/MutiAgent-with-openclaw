package handlers

import (
	"net/http"
	"os"
	"strings"
	"time"

	"edict-go/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

var (
	jwtSecret    = os.Getenv("JWT_SECRET")
	adminPass    = os.Getenv("ADMIN_PASSWORD")
	serviceToken = os.Getenv("SERVICE_TOKEN")
)

func init() {
	if jwtSecret == "" {
		jwtSecret = "edict-super-secret-key-2026"
	}
	if adminPass == "" {
		adminPass = "admin123"
	}
	if serviceToken == "" {
		serviceToken = "edict-internal-service-token-2026"
	}
}

// 验证 JWT 或 Service Token。
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 跳过某些路径的身份验证，但目前将其应用于所有受保护的路径

		// 1. Service Token
		sToken := c.GetHeader("X-Service-Token")
		if sToken != "" && sToken == serviceToken {
			c.Next()
			return
		}

		// 2. JWT Token
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			// 检查 cookie（如果需要），但这里我们优先使用 Bearer
			c.AbortWithStatusJSON(http.StatusUnauthorized, models.APIResp{OK: false, Error: "Login required"})
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, http.ErrAbortHandler
			}
			return []byte(jwtSecret), nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, models.APIResp{OK: false, Error: "Unauthorized or token expired"})
			return
		}

		// 将用户设置在上下文中
		if claims, ok := token.Claims.(jwt.MapClaims); ok {
			c.Set("username", claims["sub"])
		}

		c.Next()
	}
}

// 登录处理程序处理 POST /api/auth/login。
func LoginHandler(c *gin.Context) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.APIResp{OK: false, Error: "Invalid JSON"})
		return
	}

	if body.Username != "admin" || body.Password != adminPass {
		c.JSON(http.StatusUnauthorized, models.APIResp{OK: false, Error: "Invalid username or password"})
		return
	}

	// 创建 JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "admin",
		"exp": time.Now().Add(24 * time.Hour).Unix(),
		"iat": time.Now().Unix(),
	})

	tokenString, err := token.SignedString([]byte(jwtSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.APIResp{OK: false, Error: "Could not generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":           true,
		"access_token": tokenString,
		"token_type":   "bearer",
	})
}
