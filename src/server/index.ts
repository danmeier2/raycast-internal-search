import express from 'express';
import type { Request, Response } from 'express';
import { searchIndex } from '../services/search/index.js';
import { mcpService } from '../services/mcp/index.js';

const app = express();
const BASE_PORT = 49152;
const MAX_PORT_TRIES = 10;
let currentPort: number | null = null;
let indexReady = false;

// Initialize search index
console.log('Initializing search index...');
searchIndex.buildIndex()
  .then(() => {
    console.log('Search index built successfully');
    indexReady = true;
  })
  .catch(error => {
    console.error('Failed to build search index:', error);
    process.exit(1); // Exit if we can't build the index
  });

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  if (!indexReady && req.path !== '/health') {
    res.status(503).json({ error: 'Service is starting up, please try again in a moment' });
    return;
  }
  next();
});

// Routes
app.get('/health', async (req: Request, res: Response) => {
  console.log('Health check requested');
  const stats = searchIndex.getStats();
  res.json({ 
    status: 'ok',
    search: {
      totalFiles: stats.totalFiles,
      isIndexing: stats.isIndexing,
      indexReady
    }
  });
});

app.get('/files', async (req: Request, res: Response) => {
  console.log('Listing files');
  try {
    const files = await mcpService.listFiles();
    res.json({ files });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

app.get('/file', async (req: Request, res: Response) => {
  const { path } = req.query;
  console.log('Reading file:', path);
  try {
    if (!path || typeof path !== 'string') {
      res.status(400).json({ error: 'Path is required' });
      return;
    }
    const content = await mcpService.readFile(path);
    res.json(content);
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

app.post('/search', async (req: Request, res: Response) => {
  const { query, fileTypes } = req.body;
  console.log('Search requested:', query, 'fileTypes:', fileTypes);
  try {
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    // Validate fileTypes if provided
    if (fileTypes !== undefined) {
      if (!Array.isArray(fileTypes) || !fileTypes.every(type => typeof type === 'string')) {
        res.status(400).json({ error: 'fileTypes must be an array of strings' });
        return;
      }
    }

    const startTime = Date.now();
    const results = searchIndex.search(query, { fileTypes });
    const endTime = Date.now();
    
    console.log(`Search completed in ${endTime - startTime}ms, found ${results.length} results`);
    
    res.json({ 
      results,
      stats: {
        totalResults: results.length,
        searchTime: endTime - startTime,
        filters: {
          fileTypes: fileTypes || []
        }
      }
    });
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Start the server
export async function startServer(): Promise<void> {
  console.log('Starting server...');
  let lastError: Error | null = null;
  
  for (let port = BASE_PORT; port < BASE_PORT + MAX_PORT_TRIES; port++) {
    try {
      console.log(`Attempting to start server on port ${port}...`);
      await new Promise<void>((resolve, reject) => {
        const server = app.listen(port)
          .once('listening', () => {
            currentPort = port;
            console.log(`File Search Server running on port ${port}`);
            resolve();
          })
          .once('error', (err) => {
            console.error(`Failed to start on port ${port}:`, err);
            reject(err);
          });
      });
      return; // Server started successfully
    } catch (error) {
      lastError = error as Error;
      console.log(`Port ${port} is in use, trying next port...`);
      continue;
    }
  }
  
  throw new Error(`Failed to start server: ${lastError?.message || 'No available ports'}`);
}

export function getPort(): number | null {
  return currentPort;
}

// Start server if this file is run directly
if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  console.log('Starting server in standalone mode');
  startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export class ServerManager {
  private static instance: ServerManager | null = null;
  private port: number | null = null;

  private constructor() {}

  public static getInstance(): ServerManager {
    if (!ServerManager.instance) {
      ServerManager.instance = new ServerManager();
    }
    return ServerManager.instance;
  }

  public async start(): Promise<void> {
    await startServer();
    this.port = currentPort;
  }

  public getPort(): number | null {
    return this.port;
  }

  public async stop(): Promise<void> {
    // TODO: Implement server shutdown
  }
}

export const serverManager = ServerManager.getInstance(); 