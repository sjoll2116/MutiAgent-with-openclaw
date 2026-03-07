import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const toast = useStore((s) => s.toast);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await api.login(password);
            if (res.ok) {
                onLogin();
            } else {
                toast(res.error || '登录失败', 'err');
            }
        } catch (err) {
            toast('服务器连接失败', 'err');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: 'radial-gradient(circle at center, #1a1a2e 0%, #0f0f1a 100%)'
        }}>
            <div className="login-card" style={{
                background: 'rgba(255, 255, 255, 0.03)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '24px',
                padding: '48px',
                width: '100%',
                maxWidth: '400px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                textAlign: 'center'
            }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚔️</div>
                <h1 style={{
                    fontSize: '28px',
                    fontWeight: 800,
                    marginBottom: '8px',
                    letterSpacing: '-0.02em',
                    background: 'linear-gradient(to right, #fff, #94a3b8)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                }}>
                    三省六部
                </h1>
                <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '32px' }}>
                    Multi-Agent Orchestration System
                </p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ textAlign: 'left' }}>
                        <label style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', display: 'block', marginBottom: '8px', marginLeft: '4px' }}>
                            身份验证密码
                        </label>
                        <input
                            type="password"
                            placeholder="请输入管理员密码"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoFocus
                            style={{
                                width: '100%',
                                padding: '14px 18px',
                                background: 'rgba(0, 0, 0, 0.2)',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '12px',
                                color: '#fff',
                                fontSize: '15px',
                                outline: 'none',
                                transition: 'border-color 0.2s'
                            }}
                            onFocus={(e) => e.target.style.borderColor = 'var(--acc)'}
                            onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            padding: '14px',
                            background: 'var(--acc)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '12px',
                            fontSize: '15px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            marginTop: '8px',
                            boxShadow: '0 10px 15px -3px rgba(124, 58, 237, 0.3)',
                            transition: 'transform 0.1s, filter 0.2s'
                        }}
                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        onMouseOver={(e) => e.currentTarget.style.filter = 'brightness(1.1)'}
                        onMouseOut={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                    >
                        {loading ? '验证中...' : '进入朝廷'}
                    </button>
                </form>

                <div style={{ marginTop: '32px', fontSize: '12px', color: 'rgba(255, 255, 255, 0.3)' }}>
                    EDICT OS v2.0.0
                </div>
            </div>
        </div>
    );
}
