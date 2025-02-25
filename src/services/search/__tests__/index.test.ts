import { SearchIndex } from '../index.js';
import { mcpService } from '../../mcp/index.js';
import type { MCPFileContent } from '../../mcp/index.js';

jest.mock('../../mcp', () => ({
  mcpService: {
    listFiles: jest.fn(),
    readFile: jest.fn()
  }
}));

describe('SearchIndex', () => {
  let searchIndex: SearchIndex;
  const mockFiles = [
    '/downloads/test1.txt',
    '/downloads/test2.pdf',
    '/downloads/subfolder/test3.doc'
  ];

  beforeEach(() => {
    searchIndex = new SearchIndex();
    (mcpService.listFiles as jest.Mock).mockResolvedValue(mockFiles);
    (mcpService.readFile as jest.Mock).mockImplementation((filePath: string): Promise<Partial<MCPFileContent>> => 
      Promise.resolve({
        lastModified: Date.now(),
        size: 1000
      })
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('buildIndex', () => {
    it('should build index from files', async () => {
      const indexingStart = jest.fn();
      const indexingComplete = jest.fn();
      
      searchIndex.on('indexing:start', indexingStart);
      searchIndex.on('indexing:complete', indexingComplete);

      await searchIndex.buildIndex();

      expect(indexingStart).toHaveBeenCalled();
      expect(indexingComplete).toHaveBeenCalledWith({ totalFiles: mockFiles.length });
      expect(mcpService.listFiles).toHaveBeenCalled();
      expect(mcpService.readFile).toHaveBeenCalledTimes(mockFiles.length);
    });

    it('should not rebuild index if already indexing', async () => {
      const firstBuild = searchIndex.buildIndex();
      const secondBuild = searchIndex.buildIndex();

      await Promise.all([firstBuild, secondBuild]);
      expect(mcpService.listFiles).toHaveBeenCalledTimes(1);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await searchIndex.buildIndex();
    });

    it('should return empty array for empty query', () => {
      expect(searchIndex.search('')).toHaveLength(0);
      expect(searchIndex.search('  ')).toHaveLength(0);
    });

    it('should find files by filename', () => {
      const results = searchIndex.search('test');
      expect(results).toHaveLength(3);
    });

    it('should find files by path', () => {
      const results = searchIndex.search('subfolder');
      expect(results).toHaveLength(1);
      expect(results[0].path).toContain('subfolder');
    });

    it('should prioritize exact matches', () => {
      const results = searchIndex.search('test1');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].filename).toBe('test1.txt');
      expect(results[0].matchType).toBe('exact');
      expect(results[0].score).toBe(1.0);
    });

    it('should filter results by file type', () => {
      const results = searchIndex.search('test', { fileTypes: ['txt'] });
      expect(results).toHaveLength(1);
      expect(results[0].filename).toBe('test1.txt');
    });

    it('should handle multiple file types', () => {
      const results = searchIndex.search('test', { fileTypes: ['txt', 'pdf'] });
      expect(results).toHaveLength(2);
      expect(results.map(r => r.filename)).toContain('test1.txt');
      expect(results.map(r => r.filename)).toContain('test2.pdf');
    });

    it('should return empty array when no files match the file type filter', () => {
      const results = searchIndex.search('test', { fileTypes: ['jpg'] });
      expect(results).toHaveLength(0);
    });

    it('should ignore file type filter if empty array provided', () => {
      const results = searchIndex.search('test', { fileTypes: [] });
      expect(results).toHaveLength(3); // All test files should be returned
    });
  });

  describe('getStats', () => {
    it('should return correct stats', async () => {
      expect(searchIndex.getStats()).toEqual({
        totalFiles: 0,
        isIndexing: false
      });

      const indexPromise = searchIndex.buildIndex();
      expect(searchIndex.getStats().isIndexing).toBe(true);

      await indexPromise;
      expect(searchIndex.getStats()).toEqual({
        totalFiles: mockFiles.length,
        isIndexing: false
      });
    });
  });
}); 