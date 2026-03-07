from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from ..auth import create_access_token, verify_password, get_password_hash, ADMIN_PASSWORD, ACCESS_TOKEN_EXPIRE_MINUTES

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/login")
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    # MVP: 仅支持单管理员账号
    if form_data.username != "admin":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # 验证密码（支持明文比对或哈希比对，MVP 阶段为了方便先支持明文，建议上线后改为哈希）
    # 注意：生产环境 ADMIN_PASSWORD 应该是 hash 过的，这里为了 MVP 简单化先直接比对
    if form_data.password != ADMIN_PASSWORD:
         # 尝试哈希比对（如果环境变量里存的是哈希过的）
         try:
             if not verify_password(form_data.password, ADMIN_PASSWORD):
                 raise ValueError()
         except:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": "admin"}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}
