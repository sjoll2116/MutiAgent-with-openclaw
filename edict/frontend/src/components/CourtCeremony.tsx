import { useEffect, useState } from 'react';
import { useStore, isEdict } from '../store';
import { cn } from '../lib/utils';
import { AlertTriangle, Fingerprint, Activity, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CourtCeremony() {
  const liveStatus = useStore((s) => s.liveStatus);
  const [show, setShow] = useState(false);
  const [out, setOut] = useState(false);

  useEffect(() => {
    const lastOpen = localStorage.getItem('openclaw_court_date');
    const today = new Date().toISOString().substring(0, 10);
    const pref = JSON.parse(localStorage.getItem('openclaw_court_pref') || '{"enabled":true}');
    if (!pref.enabled || lastOpen === today) return;
    localStorage.setItem('openclaw_court_date', today);
    setShow(true);
    const timer = setTimeout(() => skip(), 4000);
    return () => clearTimeout(timer);
  }, []);

  const skip = () => {
    setOut(true);
    setTimeout(() => setShow(false), 600);
  };

  if (!show) return null;

  const tasks = liveStatus?.tasks || [];
  const jjc = tasks.filter(isEdict);
  const pending = jjc.filter((t) => !['Completed', 'Cancelled'].includes(t.state)).length;
  const done = jjc.filter((t) => t.state === 'Completed').length;
  const overdue = jjc.filter(
    (t) => t.state !== 'Completed' && t.state !== 'Cancelled' && t.eta && new Date(t.eta.replace(' ', 'T')) < new Date()
  ).length;

  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} · ${days[d.getDay()]}`;

  return (
    <AnimatePresence>
      {!out && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, filter: 'blur(20px)' }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-slate-900 overflow-hidden cursor-pointer selection:bg-transparent"
          onClick={skip}
        >
          {/* Subtle grid background */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
          
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-500/10 blur-[100px] rounded-full pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center text-center max-w-2xl px-6">
            <motion.div 
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.8, type: "spring" }}
              className="mb-8 p-6 bg-slate-800/50 rounded-3xl border border-slate-700/50 backdrop-blur-md shadow-2xl"
            >
               <Fingerprint className="w-16 h-16 text-primary-400 opacity-80" strokeWidth={1} />
            </motion.div>

            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="space-y-6"
            >
              <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight flex items-center justify-center gap-4">
                <span className="bg-gradient-to-r from-primary-400 to-indigo-400 bg-clip-text text-transparent">SYSTEM INITIALIZED</span>
              </h1>

              <div className="flex items-center justify-center gap-2 text-slate-400 text-sm md:text-base font-semibold tracking-widest uppercase">
                <Activity className="w-4 h-4 text-emerald-400 animate-pulse" /> Multi-Agent Engine Online
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
                 <div className="px-4 py-2 bg-slate-800/80 rounded-xl border border-slate-700 backdrop-blur text-sm font-medium">
                   <span className="text-slate-400 mr-2">Pending</span> 
                   <span className="text-white font-bold">{pending}</span>
                 </div>
                 <div className="px-4 py-2 bg-slate-800/80 rounded-xl border border-slate-700 backdrop-blur text-sm font-medium">
                   <span className="text-slate-400 mr-2">Resolved</span> 
                   <span className="text-emerald-400 font-bold">{done}</span>
                 </div>
                 {overdue > 0 && (
                   <div className="px-4 py-2 bg-red-900/30 rounded-xl border border-red-500/30 backdrop-blur text-sm font-medium flex items-center gap-2">
                     <AlertTriangle className="w-4 h-4 text-red-400" />
                     <span className="text-red-300">Overdue {overdue}</span>
                   </div>
                 )}
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5, duration: 1 }}
              className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 text-slate-500"
            >
              <div className="text-xs font-mono font-bold tracking-widest uppercase flex items-center gap-2 bg-slate-800/50 px-4 py-1.5 rounded-full border border-slate-700/50">
                 <Clock className="w-3.5 h-3.5" /> {dateStr}
              </div>
              <div className="text-[10px] uppercase tracking-widest opacity-50 animate-pulse">
                 Click anywhere to access dashboard
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
