import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from './lib/supabase';

export type Language = 'en' | 'bn';
export type Theme = 'light' | 'dark';

export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  format: string;
  quality: string;
  status: 'starting' | 'downloading' | 'completed' | 'error';
  progress: number;
  speed: string;
  eta: string;
  timestamp: number;
}

interface AppState {
  language: Language;
  theme: Theme;
  history: DownloadItem[];
  queue: DownloadItem[];
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  addToHistory: (item: DownloadItem) => void;
  addToQueue: (item: DownloadItem) => void;
  updateQueueItem: (id: string, updates: Partial<DownloadItem>) => void;
  removeFromQueue: (id: string) => void;
  clearHistory: () => void;
  fetchHistory: () => Promise<void>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      language: 'en',
      theme: 'dark',
      history: [],
      queue: [],
      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),
      addToHistory: async (item) => {
        set((state) => {
          if (state.history.some((h) => h.id === item.id)) {
            return state;
          }
          return {
            history: [item, ...state.history].slice(0, 50), // Keep last 50
          };
        });

        // Save to Supabase
        try {
          const { error } = await supabase.from('downloads').insert([{
            id: item.id,
            url: item.url,
            title: item.title,
            thumbnail: item.thumbnail,
            format: item.format,
            quality: item.quality,
            status: item.status,
            progress: item.progress,
            speed: item.speed,
            eta: item.eta,
            timestamp: item.timestamp
          }]);
          
          if (error) {
            console.error('Supabase insert error:', error);
          }
        } catch (err) {
          console.error('Failed to save to Supabase:', err);
        }
      },
      addToQueue: (item) =>
        set((state) => {
          if (state.queue.some((q) => q.id === item.id)) {
            return state;
          }
          return {
            queue: [...state.queue, item],
          };
        }),
      updateQueueItem: (id, updates) =>
        set((state) => ({
          queue: state.queue.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          ),
        })),
      removeFromQueue: (id) =>
        set((state) => ({
          queue: state.queue.filter((item) => item.id !== id),
        })),
      clearHistory: async () => {
        set({ history: [] });
        
        // Clear from Supabase
        try {
          const { error } = await supabase.from('downloads').delete().neq('id', '0');
          if (error) {
            console.error('Supabase delete error:', error);
          }
        } catch (err) {
          console.error('Failed to clear Supabase:', err);
        }
      },
      fetchHistory: async () => {
        try {
          const { data, error } = await supabase
            .from('downloads')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(50);
            
          if (data && !error) {
            set({ history: data as DownloadItem[] });
          }
        } catch (err) {
          console.error('Failed to fetch history from Supabase:', err);
        }
      },
    }),
    {
      name: 'video-downloader-storage',
      partialize: (state) => ({
        language: state.language,
        theme: state.theme,
        history: state.history,
      }), // Don't persist queue
    }
  )
);