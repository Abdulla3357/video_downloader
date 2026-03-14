import React, { useState, useEffect } from 'react';
import { Download, Loader2, Video, AlertCircle, Music, Film, VideoOff, X, Moon, Sun, Globe, CheckCircle2, History, Trash2, ShieldCheck, Zap, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { useAppStore, DownloadItem } from './store';
import { translations } from './i18n';
import { cn } from './lib/utils';

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');

  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  const { 
    language, theme, setLanguage, setTheme, 
    queue, history, addToQueue, updateQueueItem, removeFromQueue, addToHistory, clearHistory, fetchHistory
  } = useAppStore();

  const t = translations[language];

  const getApiBaseUrl = () => {
    // 1. Check for manual override first (highest priority)
    const manualUrl = localStorage.getItem('manual_backend_url');
    if (manualUrl) return manualUrl;

    if (typeof window === 'undefined') return '';
    
    // 2. Use environment variable if provided
    if (import.meta.env.VITE_BACKEND_URL) {
      return import.meta.env.VITE_BACKEND_URL;
    }
    
    const hostname = window.location.hostname;
    
    // 3. If we are on the AI Studio preview itself, relative paths are best
    if (hostname.includes('run.app')) {
      return '';
    }
    
    // 4. Local development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000';
    }
    
    return '';
  };

  const setManualUrl = () => {
    const url = window.prompt("Enter Backend URL (e.g. https://...run.app):", getApiBaseUrl());
    if (url !== null) {
      if (url === "") localStorage.removeItem('manual_backend_url');
      else localStorage.setItem('manual_backend_url', url);
      window.location.reload();
    }
  };

  const checkBackend = React.useCallback(async (isRetry = false) => {
    // Remove the early return that was blocking the initial check
    setBackendStatus('checking');
    const baseUrl = getApiBaseUrl();
    const testUrl = baseUrl ? `${baseUrl}/api/test` : '/api/test';
    
    console.log(`[Backend Check] Attempting to connect to: ${testUrl}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const res = await fetch(testUrl, { 
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const data = await res.json();
        console.log("[Backend Check] Success:", data);
        setBackendStatus('online');
        if (isRetry) toast.success("Connected to server!");
      } else {
        console.warn(`[Backend Check] Failed with status: ${res.status}`);
        setBackendStatus('offline');
      }
    } catch (e: any) {
      console.error("[Backend Check] Error:", e.name === 'AbortError' ? 'Timeout' : e.message);
      setBackendStatus('offline');
    }
  }, [language]); // Added language as dependency since toast uses translations

  useEffect(() => {
    checkBackend();
    
    // Initial retry after 3 seconds in case server is still starting
    const initialRetry = setTimeout(() => {
      checkBackend();
    }, 3000);

    fetchHistory();
    
    // Periodically check if offline
    const interval = setInterval(() => {
      checkBackend();
    }, 60000); // Check every minute
    
    return () => {
      clearTimeout(initialRetry);
      clearInterval(interval);
    };
  }, [fetchHistory, checkBackend]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const handleDownload = (formatCode: string, ext: string, filename: string, quality: string) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(7);
    
    const newItem: DownloadItem = {
      id,
      url: info.original_url || url,
      title: info.title || 'Video',
      thumbnail: info.thumbnail || '',
      format: ext,
      quality,
      status: 'starting',
      progress: 0,
      speed: '--',
      eta: '--:--',
      timestamp: Date.now()
    };

    addToQueue(newItem);
    toast.success(t.downloadStarted);

    const baseUrl = getApiBaseUrl();
    const downloadUrl = `${baseUrl}/api/download?url=${encodeURIComponent(url)}&format=${formatCode}&ext=${ext}&id=${id}`;
    
    let iframe = document.getElementById('download-iframe') as HTMLIFrameElement;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'download-iframe';
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
    }
    iframe.src = downloadUrl;

    let notFoundCount = 0;
    const interval = setInterval(async () => {
      try {
        const baseUrl = getApiBaseUrl();
        const res = await fetch(`${baseUrl}/api/progress?id=${id}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'not_found') {
          notFoundCount++;
          if (notFoundCount > 15) {
            clearInterval(interval);
            updateQueueItem(id, { status: 'error' });
            toast.error(t.downloadError);
          }
        } else if (data.status === 'completed' || data.status === 'error') {
          clearInterval(interval);
          updateQueueItem(id, { ...data });
          
          if (data.status === 'completed') {
            toast.success(t.downloadComplete);
            addToHistory({ ...newItem, status: 'completed', progress: 100 });
          } else {
            toast.error(t.downloadError);
          }

          setTimeout(() => {
            removeFromQueue(id);
          }, 5000);
        } else {
          updateQueueItem(id, { ...data });
        }
      } catch (err) {
        console.error("Progress fetch error:", err);
      }
    }, 1000);
  };

  const fetchInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setLoading(true);
    setError('');
    setInfo(null);

    const baseUrl = getApiBaseUrl();
    const apiUrl = `${baseUrl}/api/info`;

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const contentType = res.headers.get('content-type');
      let data;
      
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch video info');
      }

      setInfo(data);
    } catch (err: any) {
      console.error("Fetch Info Error:", err);
      setError(err.message);
      toast.error(t.invalidUrl);
    } finally {
      setLoading(false);
    }
  };

  const getCategorizedFormats = () => {
    const formatSize = (bytes: number) => {
      if (!bytes) return '';
      const mb = bytes / (1024 * 1024);
      return `${mb.toFixed(1)} MB`;
    };

    if (!info || !info.formats) return { videoAudio: [], videoOnly: [], audioOnly: [], formatSize };

    const videoAudio: any[] = [];
    const videoOnly: any[] = [];
    const audioOnly: any[] = [];

    const seenVa = new Set();
    const seenVo = new Set();
    const seenAo = new Set();

    const sortedFormats = [...info.formats].sort((a: any, b: any) => {
      const hasVideoA = a.vcodec && a.vcodec !== 'none';
      const hasAudioA = a.acodec && a.acodec !== 'none';
      const hasVideoB = b.vcodec && b.vcodec !== 'none';
      const hasAudioB = b.acodec && b.acodec !== 'none';

      const getCat = (hasV: boolean, hasA: boolean) => {
        if (hasV && hasA) return 3;
        if (hasV && !hasA) return 2;
        if (!hasV && hasA) return 1;
        return 0;
      };

      const catA = getCat(hasVideoA, hasAudioA);
      const catB = getCat(hasVideoB, hasAudioB);

      if (catA !== catB) return catB - catA;

      if (catA === 3 || catA === 2) {
        if (a.height !== b.height) return (b.height || 0) - (a.height || 0);
        if (a.ext === 'mp4' && b.ext !== 'mp4') return -1;
        if (a.ext !== 'mp4' && b.ext === 'mp4') return 1;
      } else if (catA === 1) {
        if (a.abr !== b.abr) return (b.abr || 0) - (a.abr || 0);
        if (a.ext === 'm4a' && b.ext !== 'm4a') return -1;
        if (a.ext !== 'm4a' && b.ext === 'm4a') return 1;
      }
      return 0;
    });

    for (const f of sortedFormats) {
      const hasVideo = f.vcodec && f.vcodec !== 'none';
      const hasAudio = f.acodec && f.acodec !== 'none';

      if (!hasVideo && !hasAudio) continue;

      if (hasVideo && hasAudio) {
        const key = `${f.height}p`;
        if (f.height && !seenVa.has(key)) { seenVa.add(key); videoAudio.push(f); }
      } else if (hasVideo && !hasAudio) {
        const key = `${f.height}p`;
        if (f.height && !seenVo.has(key)) { seenVo.add(key); videoOnly.push(f); }
      } else if (!hasVideo && hasAudio) {
        const key = `${f.ext}-${Math.round(f.abr || 0)}`;
        if (!seenAo.has(key)) { seenAo.add(key); audioOnly.push(f); }
      }
    }

    return { videoAudio, videoOnly, audioOnly, formatSize };
  };

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'bn' : 'en');
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  const formats = getCategorizedFormats();

  const copyShareLink = () => {
    const shareUrl = process.env.APP_URL || window.location.origin;
    navigator.clipboard.writeText(shareUrl);
    toast.success("Share link copied to clipboard!");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a0a0a] text-slate-900 dark:text-slate-100 font-sans transition-colors duration-300 relative overflow-x-hidden">
      <Toaster position="top-center" theme={theme} />

      {/* Backend Status Indicator */}
      <button 
        onClick={() => {
          if (backendStatus === 'offline') setManualUrl();
          else checkBackend(true);
        }}
        disabled={backendStatus === 'checking'}
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/80 dark:bg-black/40 backdrop-blur-md border border-slate-200 dark:border-white/10 text-[10px] font-medium uppercase tracking-wider shadow-sm hover:bg-slate-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
      >
        <div className={cn(
          "w-2 h-2 rounded-full",
          backendStatus === 'online' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : 
          backendStatus === 'offline' ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : 
          "bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]"
        )} />
        <span className={cn(
          backendStatus === 'online' ? "text-emerald-600 dark:text-emerald-500" : 
          backendStatus === 'offline' ? "text-red-600 dark:text-red-500" : 
          "text-amber-600 dark:text-amber-500"
        )}>
          Server: {backendStatus}
          {backendStatus === 'offline' && (
            <span className="ml-2 px-2 py-0.5 bg-red-100 dark:bg-red-900/30 rounded text-[9px] hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">
              Click to Reconnect
            </span>
          )}
        </span>
        {backendStatus === 'checking' && <Loader2 className="w-3 h-3 animate-spin text-amber-500" />}
      </button>
      
      {/* Animated Background Blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="blob bg-indigo-500/20 dark:bg-indigo-600/20 w-96 h-96 rounded-full top-[-10%] left-[-10%] mix-blend-multiply dark:mix-blend-screen" />
        <div className="blob bg-purple-500/20 dark:bg-purple-600/20 w-[30rem] h-[30rem] rounded-full bottom-[-10%] right-[-10%] mix-blend-multiply dark:mix-blend-screen" style={{ animationDelay: '2s' }} />
        <div className="blob bg-pink-500/20 dark:bg-pink-600/20 w-80 h-80 rounded-full top-[40%] left-[60%] mix-blend-multiply dark:mix-blend-screen" style={{ animationDelay: '4s' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-slate-200 dark:border-white/10 glass sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-xl">
              <Video className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight hidden sm:block">UniDownloader</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={copyShareLink}
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-all shadow-lg shadow-indigo-500/20"
            >
              <Globe className="w-4 h-4" />
              Share App
            </button>
            <button 
              onClick={toggleLanguage}
              className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-white/10 transition-colors flex items-center gap-2 text-sm font-medium"
            >
              <Globe className="w-4 h-4" />
              {language === 'en' ? 'BN' : 'EN'}
            </button>
            <button 
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
            >
              {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-16">
        
        {/* Hero Section */}
        <section className="text-center space-y-6 max-w-3xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-sm font-medium mb-4"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
            </span>
            Sora AI Supported
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white"
          >
            {t.title}
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-slate-600 dark:text-slate-400"
          >
            {t.subtitle}
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-8"
          >
            <form onSubmit={fetchInfo} className="glass p-2 rounded-2xl flex flex-col sm:flex-row gap-2 shadow-xl shadow-indigo-500/5 dark:shadow-none">
              <input
                type="url"
                placeholder={t.placeholder}
                className="flex-1 px-6 py-4 rounded-xl bg-white/50 dark:bg-black/50 border border-transparent focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-slate-900 dark:text-white placeholder:text-slate-500"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98]"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t.fetch}
              </button>
            </form>
          </motion.div>
        </section>

        {/* Error State */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 p-4 rounded-2xl flex items-start gap-3 max-w-3xl mx-auto"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p>{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Video Info & Download Options */}
        <AnimatePresence>
          {info && (
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              className="glass rounded-3xl overflow-hidden shadow-2xl shadow-indigo-500/5 dark:shadow-none max-w-4xl mx-auto"
            >
              <div className="p-6 md:p-8 border-b border-slate-200 dark:border-white/10 flex flex-col md:flex-row gap-8 items-center md:items-start">
                {info.thumbnail && (
                  <div className="relative w-full md:w-72 aspect-video rounded-2xl overflow-hidden shadow-lg flex-shrink-0 bg-slate-200 dark:bg-slate-800">
                    <img
                      src={info.thumbnail}
                      alt={info.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                      <span className="bg-black/60 backdrop-blur-md text-white text-xs px-2 py-1 rounded-md font-medium">
                        {Math.floor((info.duration || 0) / 60)}:{String((info.duration || 0) % 60).padStart(2, '0')}
                      </span>
                      <span className="bg-indigo-600 text-white text-xs px-2 py-1 rounded-md font-medium uppercase">
                        {info.extractor_key}
                      </span>
                    </div>
                  </div>
                )}
                <div className="space-y-4 flex-1 text-center md:text-left">
                  <h2 className="text-2xl font-bold line-clamp-2" title={info.title}>{info.title}</h2>
                  {info.extractor_key?.toLowerCase().includes('sora') && (
                    <p className="text-emerald-600 dark:text-emerald-400 text-sm font-medium flex items-center justify-center md:justify-start gap-1">
                      <CheckCircle2 className="w-4 h-4" /> {t.soraNotice}
                    </p>
                  )}
                </div>
              </div>

              <div className="p-6 md:p-8 bg-slate-50/50 dark:bg-black/20 space-y-8">
                {/* Quick Downloads */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                    <Video className="w-4 h-4" /> Quick Downloads
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* 4K Option (Conditional) */}
                    {info?.formats?.some((f: any) => f.height && f.height >= 2160) && (
                      <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-500/30 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 hover:shadow-md transition-shadow">
                        <div className="flex flex-col text-center sm:text-left">
                          <span className="font-semibold text-slate-900 dark:text-white">4K (2160p)</span>
                          <span className="text-sm text-slate-500 dark:text-slate-400">Ultra HD quality</span>
                        </div>
                        <button
                          onClick={() => handleDownload('2160p', 'mp4', 'video_4k.mp4', '4K')}
                          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-xl font-medium transition-all hover:scale-105 active:scale-95"
                        >
                          <Download className="w-4 h-4" />
                          <span className="inline">{t.download}</span>
                        </button>
                      </div>
                    )}

                    {/* 1080p Option */}
                    <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-500/30 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 hover:shadow-md transition-shadow">
                      <div className="flex flex-col text-center sm:text-left">
                        <span className="font-semibold text-slate-900 dark:text-white">1080p (Full HD)</span>
                        <span className="text-sm text-slate-500 dark:text-slate-400">High quality video</span>
                      </div>
                      <button
                        onClick={() => handleDownload('1080p', 'mp4', 'video_1080p.mp4', '1080p')}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium transition-all hover:scale-105 active:scale-95"
                      >
                        <Download className="w-4 h-4" />
                        <span className="inline">{t.download}</span>
                      </button>
                    </div>

                    {/* 480p Option */}
                    <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-500/30 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 hover:shadow-md transition-shadow">
                      <div className="flex flex-col text-center sm:text-left">
                        <span className="font-semibold text-slate-900 dark:text-white">480p (Standard)</span>
                        <span className="text-sm text-slate-500 dark:text-slate-400">Data saver quality</span>
                      </div>
                      <button
                        onClick={() => handleDownload('480p', 'mp4', 'video_480p.mp4', '480p')}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 rounded-xl font-medium transition-all hover:scale-105 active:scale-95"
                      >
                        <Download className="w-4 h-4" />
                        <span className="inline">{t.download}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Audio Only */}
                {formats.audioOnly.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                      <Music className="w-4 h-4" /> Audio Only
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {formats.audioOnly.map((format: any, index: number) => (
                        <div key={`${format.format_id}-${index}`} className="group flex items-center justify-between bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-white/10 hover:border-indigo-500 transition-all hover:shadow-md">
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900 dark:text-white">{Math.round(format.abr || 0)} kbps</span>
                            <span className="text-xs text-slate-500 uppercase">
                              {format.ext}
                              {format.filesize || format.filesize_approx ? ` • ${formats.formatSize(format.filesize || format.filesize_approx)}` : ''}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDownload(format.format_id, format.ext, `audio.${format.ext}`, `${Math.round(format.abr || 0)}kbps`)}
                            className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-900 dark:text-white px-4 py-2 rounded-xl text-sm font-medium transition-all group-hover:scale-105"
                          >
                            <Download className="w-4 h-4" />
                            <span className="inline">{t.download}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bento Grid Features */}
        {!info && (
          <section className="space-y-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold">{t.features}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="glass p-6 rounded-3xl space-y-4 hover:-translate-y-1 transition-transform duration-300">
                <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Zap className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold">{t.fast}</h3>
                <p className="text-slate-500 dark:text-slate-400">{t.fastDesc}</p>
              </div>
              <div className="glass p-6 rounded-3xl space-y-4 hover:-translate-y-1 transition-transform duration-300">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold">{t.secure}</h3>
                <p className="text-slate-500 dark:text-slate-400">{t.secureDesc}</p>
              </div>
              <div className="glass p-6 rounded-3xl space-y-4 hover:-translate-y-1 transition-transform duration-300">
                <div className="w-12 h-12 bg-pink-100 dark:bg-pink-500/20 rounded-2xl flex items-center justify-center text-pink-600 dark:text-pink-400">
                  <Layers className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold">{t.allFormats}</h3>
                <p className="text-slate-500 dark:text-slate-400">{t.allFormatsDesc}</p>
              </div>
            </div>
          </section>
        )}

        {/* Download History */}
        {history.length > 0 && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <History className="w-6 h-6" /> {t.history}
              </h2>
              <button 
                onClick={clearHistory}
                className="text-sm text-red-500 hover:text-red-600 flex items-center gap-1 font-medium"
              >
                <Trash2 className="w-4 h-4" /> {t.clearHistory}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.map((item, index) => (
                <div key={`${item.id}-${index}`} className="glass p-4 rounded-2xl flex gap-4 items-center">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" className="w-16 h-16 rounded-xl object-cover bg-slate-200 dark:bg-slate-800" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
                      <Video className="w-6 h-6 text-slate-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm truncate" title={item.title}>{item.title}</h4>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      <span className="uppercase bg-slate-100 dark:bg-white/10 px-2 py-0.5 rounded-md">{item.format}</span>
                      <span>{item.quality}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-200 dark:border-white/10 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-slate-500 text-sm">{t.footerText}</p>
          <p className="text-slate-500 text-sm flex items-center gap-1">{t.madeWith}</p>
        </div>
      </footer>

      {/* Download Queue Overlay */}
      <AnimatePresence>
        {queue.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            className="fixed bottom-6 right-6 w-80 sm:w-96 glass rounded-3xl shadow-2xl z-50 overflow-hidden border border-white/20"
          >
            <div className="p-4 border-b border-slate-200 dark:border-white/10 bg-white/50 dark:bg-black/50 flex justify-between items-center backdrop-blur-xl">
              <h3 className="font-bold flex items-center gap-2">
                <Download className="w-4 h-4" /> {t.queue}
              </h3>
              <span className="text-xs bg-indigo-600 text-white px-2 py-1 rounded-full font-medium">
                {queue.length} active
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto p-4 space-y-4 bg-white/80 dark:bg-black/80 backdrop-blur-xl">
              {queue.map((dl, index) => (
                <div key={`${dl.id}-${index}`} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium truncate pr-2" title={dl.title}>{dl.title}</span>
                    <span className="text-slate-500 flex-shrink-0 font-mono">{dl.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        dl.status === 'error' ? 'bg-red-500' : 
                        dl.status === 'completed' ? 'bg-emerald-500' : 
                        'bg-indigo-600'
                      )}
                      style={{ width: `${dl.progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 font-mono">
                    <span>
                      {dl.status === 'starting' ? 'Starting...' : 
                       dl.status === 'completed' ? 'Completed' : 
                       dl.status === 'error' ? 'Failed' : 
                       dl.speed}
                    </span>
                    {dl.status === 'downloading' && <span>ETA: {dl.eta}</span>}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
