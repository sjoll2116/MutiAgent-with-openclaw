import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { TerminalSquare, Lock, ArrowRight, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';

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
                toast(res.error || '认证失败', 'err');
            }
        } catch (err) {
            toast('网络异常，请重试', 'err');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 selection:bg-primary-200 font-sans">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="w-full max-w-md bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 overflow-hidden relative"
            >
                <div className="h-2 w-full bg-gradient-to-r from-primary-500 via-indigo-500 to-emerald-500" />
                
                <div className="p-8 md:p-10">
                    <div className="flex justify-center mb-8">
                       <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center shadow-inner">
                         <TerminalSquare className="w-8 h-8 text-primary-600" />
                       </div>
                    </div>

                    <div className="text-center mb-10">
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight mb-2">
                            OpenClaw MAS
                        </h1>
                        <p className="text-sm font-semibold text-slate-500">
                            多智能体引擎控制台
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-600 uppercase tracking-widest flex items-center gap-2 px-1">
                                <Lock className="w-3.5 h-3.5 text-slate-400" /> 系统权限认证
                            </label>
                            <input
                                type="password"
                                placeholder="输入管理员访问密钥"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoFocus
                                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm font-medium focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all placeholder:text-slate-400 shadow-inner"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex items-center justify-center gap-2 py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-bold shadow-[0_4px_14px_0_rgb(79,70,229,0.3)] hover:shadow-[0_6px_20px_rgba(79,70,229,0.23)] transition-all disabled:opacity-70 disabled:cursor-not-allowed group active:scale-[0.98]"
                        >
                            {loading ? (
                              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                登入系统管理中枢 <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                              </>
                            )}
                        </button>
                    </form>

                    <div className="mt-10 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400">
                        <ShieldCheck className="w-4 h-4 text-emerald-500" /> EDICT OS v2.0.0
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
