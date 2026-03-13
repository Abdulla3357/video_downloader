import express from 'express';
import { createServer as createViteServer } from 'vite';
import youtubedl from 'youtube-dl-exec';
import cors from 'cors';
import path from 'path';

const downloadProgress = new Map<string, any>();

// Helper to fetch Sora video info via soravdl.com
async function getSoraInfo(url: string) {
  try {
    const getRes = await fetch('https://soravdl.com/');
    const html = await getRes.text();
    const tokenMatch = html.match(/<meta name="csrf-token" content="(.*?)">/);
    const token = tokenMatch ? tokenMatch[1] : '';
    
    const cookies = getRes.headers.get('set-cookie');
    const cookieStr = cookies ? cookies.split(',').map(c => c.split(';')[0]).join('; ') : '';

    const postRes = await fetch('https://soravdl.com/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': token,
        'Accept': 'application/json',
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://soravdl.com',
        'Referer': 'https://soravdl.com/'
      },
      body: JSON.stringify({ url })
    });
    
    const data = await postRes.json();
    if (data.success && data.downloads) {
      return {
        id: data.post_id,
        title: data.info?.title || 'Sora AI Video',
        thumbnail: data.downloads.thumbnail ? `https://soravdl.com${data.downloads.thumbnail}` : null,
        extractor_key: 'Sora',
        duration: 0,
        formats: [
          {
            format_id: 'sora_mp4',
            ext: 'mp4',
            vcodec: 'h264',
            acodec: 'none', // Sora videos usually don't have audio
            height: 1080,
            url: `https://soravdl.com${data.downloads.video_no_watermark}`
          }
        ]
      };
    }
    throw new Error(data.message || data.error || 'Failed to fetch Sora video');
  } catch (err: any) {
    throw new Error(`Sora API Error: ${err.message}`);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With']
  }));
  app.use(express.json());

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - Origin: ${req.headers.origin}`);
    next();
  });

  app.get('/api/test', (req, res) => {
    console.log('Backend test request received');
    res.json({ status: 'ok', message: 'Backend is working', timestamp: Date.now() });
  });

  app.get('/api/progress', (req, res) => {
    const { id } = req.query;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'ID required' });
    const progress = downloadProgress.get(id);
    if (progress) {
      res.json(progress);
    } else {
      res.json({ status: 'not_found' });
    }
  });

  app.post('/api/info', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      // Special handling for Sora videos
      if (url.includes('sora.chatgpt.com') || url.includes('sora.com')) {
        const soraInfo = await getSoraInfo(url);
        return res.json(soraInfo);
      }

      const options: any = {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        noPlaylist: true,
        geoBypass: true,
        addHeader: [
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
      };

      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        options.extractorArgs = 'youtube:player_client=android';
        options.addHeader.push('referer:https://www.youtube.com');
      } else if (url.includes('tiktok.com')) {
        options.addHeader.push('referer:https://www.tiktok.com/');
        options.addHeader.push('user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        options.addHeader.push('accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7');
      }

      const info = await youtubedl(url, options);

      res.json(info);
    } catch (error: any) {
      console.error("Error fetching info:", error);
      // Extract the actual stderr from yt-dlp if available
      const errorMessage = error.stderr || error.message || 'Failed to fetch video info. The link might be invalid or restricted.';
      res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/api/download', async (req, res) => {
    const { url, format, ext, id } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).send('URL is required');
    }

    // Special handling for Sora videos
    if (url.includes('sora.chatgpt.com') || url.includes('sora.com')) {
      try {
        const soraInfo = await getSoraInfo(url);
        const downloadUrl = soraInfo.formats[0].url;
        
        if (id && typeof id === 'string') {
          downloadProgress.set(id, { percent: 0, eta: '--:--', speed: '--', status: 'starting' });
        }

        res.setHeader('Content-Disposition', `attachment; filename="sora_video.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');

        const videoRes = await fetch(downloadUrl);
        if (!videoRes.ok) throw new Error('Failed to fetch video from SoraVDL');
        
        const totalSize = parseInt(videoRes.headers.get('content-length') || '0', 10);
        let downloaded = 0;

        if (videoRes.body) {
          // Node.js fetch response body is a web stream, we need to convert it or pipe it
          const reader = videoRes.body.getReader();
          
          const pump = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
                if (id && typeof id === 'string') {
                  downloadProgress.set(id, { percent: 100, eta: '00:00', speed: '0B/s', status: 'completed' });
                  setTimeout(() => downloadProgress.delete(id), 60000);
                }
                break;
              }
              
              downloaded += value.length;
              if (totalSize > 0 && id && typeof id === 'string') {
                const percent = Math.round((downloaded / totalSize) * 100);
                downloadProgress.set(id, {
                  percent,
                  eta: '--:--',
                  speed: '--',
                  status: 'downloading'
                });
              }
              
              res.write(value);
            }
          };
          
          await pump();
          return;
        }
      } catch (err) {
        console.error("Sora download error:", err);
        if (id && typeof id === 'string') {
          downloadProgress.set(id, { status: 'error' });
          setTimeout(() => downloadProgress.delete(id), 60000);
        }
        if (!res.headersSent) res.status(500).send('Sora download failed');
        return;
      }
    }

    // Use 'b' instead of 'best' to ensure we get a single pre-merged file.
    // yt-dlp cannot stream merged formats (requiring ffmpeg) to stdout.
    let formatCode = (format as string) || 'b';
    if (format === 'best') formatCode = 'b';
    else if (format === '2160p') formatCode = 'b[height<=2160]';
    else if (format === '1080p') formatCode = 'b[height<=1080]';
    else if (format === '480p') formatCode = 'b[height<=480]';

    const extension = (ext as string) || 'mp4';

    if (id && typeof id === 'string') {
      downloadProgress.set(id, { percent: 0, eta: '--:--', speed: '--', status: 'starting' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="video.${extension}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    try {
      const subprocess = youtubedl.exec(url, {
        format: formatCode,
        output: '-', // Stream to stdout
        newline: true, // Force progress to stderr on new lines
        noWarnings: true,
        noCheckCertificates: true,
        extractorArgs: 'youtube:player_client=android',
      } as any);

      if (id && typeof id === 'string' && subprocess.stderr) {
        subprocess.stderr.on('data', (data) => {
          const text = data.toString();
          const percentMatch = text.match(/([\d.]+)%/);
          const etaMatch = text.match(/ETA\s+([\d:]+)/);
          const speedMatch = text.match(/at\s+([^\s]+)/);

          if (percentMatch) {
            downloadProgress.set(id, {
              percent: parseFloat(percentMatch[1]),
              eta: etaMatch ? etaMatch[1] : '--:--',
              speed: speedMatch ? speedMatch[1] : '--',
              status: 'downloading'
            });
          }
        });
      }

      if (subprocess.stdout) {
        subprocess.stdout.pipe(res);
      }

      subprocess.on('close', () => {
        if (id && typeof id === 'string') {
          downloadProgress.set(id, { percent: 100, eta: '00:00', speed: '0B/s', status: 'completed' });
          setTimeout(() => downloadProgress.delete(id), 60000);
        }
      });

      subprocess.on('error', (err) => {
        console.error('Download error:', err);
        if (id && typeof id === 'string') {
          downloadProgress.set(id, { status: 'error' });
          setTimeout(() => downloadProgress.delete(id), 60000);
        }
        if (!res.headersSent) {
          res.status(500).send('Download failed');
        }
      });
    } catch (error) {
      console.error("Error downloading:", error);
      if (id && typeof id === 'string') {
        downloadProgress.set(id, { status: 'error' });
        setTimeout(() => downloadProgress.delete(id), 60000);
      }
      if (!res.headersSent) {
        res.status(500).send('Download failed');
      }
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
