import { useStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { CheckCircle2, AlertCircle, Info, XCircle } from 'lucide-react';

export default function Toaster() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;

  return (
    <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none w-80">
      <AnimatePresence>
        {toasts.map((t) => {
          let Icon = Info;
          const typeStr = t.type as string;
          if (typeStr === 'ok') Icon = CheckCircle2;
          if (typeStr === 'err') Icon = XCircle;
          if (typeStr === 'warn') Icon = AlertCircle;

          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, scale: 0.9, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 20 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border backdrop-blur-md",
                t.type === 'ok' ? "bg-emerald-50/95 border-emerald-200" :
                t.type === 'err' ? "bg-red-50/95 border-red-200" :
                t.type === 'warn' ? "bg-amber-50/95 border-amber-200" :
                "bg-white/95 border-slate-200 border-l-4 border-l-primary-500"
              )}
            >
              <Icon className={cn(
                "w-5 h-5 shrink-0",
                t.type === 'ok' ? "text-emerald-500" :
                t.type === 'err' ? "text-red-500" :
                t.type === 'warn' ? "text-amber-500" :
                "text-primary-500"
              )} />
              <p className={cn(
                "text-sm font-semibold leading-snug",
                t.type === 'ok' ? "text-emerald-800" :
                t.type === 'err' ? "text-red-800" :
                t.type === 'warn' ? "text-amber-800" :
                "text-slate-700"
              )}>
                {t.msg}
              </p>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
