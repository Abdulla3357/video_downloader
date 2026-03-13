import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL || 'https://magylulcgeyfrluoadoz.supabase.co';
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1hZ3lsdWxjZ2V5ZnJsdW9hZG96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MDQyNDgsImV4cCI6MjA4ODk4MDI0OH0.MtTC-5lBzConGVNEsVXNv09otHkcjnpXtZMZ09izCe4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
