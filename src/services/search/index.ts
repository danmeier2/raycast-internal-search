import { EventEmitter } from 'events';
import path from 'path';
import Fuse from 'fuse.js';
import { mcpService } from '../mcp/index.js';

interface BasicIndexEntry {
  path: string;
  filename: string;
  lastModified: number;
  size: number;
  content?: string; // Optional content field
}

interface SnippetMatch {
  text: string;
  score: number;
  position: number;
}

interface SearchResult extends BasicIndexEntry {
  score: number;
  matchType: 'exact' | 'fuzzy' | 'path' | 'content';
  snippets?: SnippetMatch[];
}

interface SearchOptions {
  fileTypes?: string[];  // List of file extensions to filter by (e.g. ['pdf', 'txt'])
  snippetContextSize?: number;
  maxSnippets?: number;
}

interface FuseResult {
  item: string;
  score: number;
}

export class SearchIndex extends EventEmitter {
  private memoryIndex: Map<string, BasicIndexEntry>;
  private filenameIndex: Fuse<string>;
  private isIndexing: boolean;

  // Fuse.js options for filename matching
  private readonly fuseOptions = {
    threshold: 0.4,     // 0.0 = perfect match, 1.0 = match anything
    minMatchCharLength: 2,
    shouldSort: true,
    includeScore: true
  };

  constructor() {
    super();
    this.memoryIndex = new Map();
    this.filenameIndex = new Fuse([], this.fuseOptions);
    this.isIndexing = false;
  }

  private extractSnippets(content: string, query: string, maxSnippets: number = 3, contextSize: number = 60): SnippetMatch[] {
    if (!content || content.trim().length === 0) {
      console.warn('Warning: Attempting to extract snippets from empty content');
      return [];
    }

    const normalizedContent = content.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    const matches: SnippetMatch[] = [];
    
    // Split query into words for better partial matching
    const queryWords = normalizedQuery.split(/\s+/).filter(word => word.length > 2);
    
    // First try exact phrase matching
    let lastIndex = 0;
    let exactMatches = false;
    
    while ((lastIndex = normalizedContent.indexOf(normalizedQuery, lastIndex)) !== -1) {
      exactMatches = true;
      const snippetStart = Math.max(0, lastIndex - contextSize);
      const snippetEnd = Math.min(content.length, lastIndex + query.length + contextSize);
      
      let snippet = content.substring(snippetStart, snippetEnd);
      if (snippetStart > 0) snippet = '...' + snippet;
      if (snippetEnd < content.length) snippet = snippet + '...';

      // Calculate snippet relevance score
      const positionScore = 1 - (lastIndex / content.length);
      const termScore = (snippet.toLowerCase().match(new RegExp(normalizedQuery, 'g')) || []).length * 0.2;
      const score = positionScore + termScore + 0.5; // Higher base score for exact matches

      matches.push({
        text: snippet,
        score,
        position: lastIndex
      });

      lastIndex += query.length;
    }
    
    // If no exact matches or not enough matches, try partial matching with individual words
    if (!exactMatches || matches.length < maxSnippets) {
      console.log(`Trying partial matches for "${normalizedQuery}" with words: ${queryWords.join(', ')}`);
      
      // For each paragraph or section in the content
      const paragraphs = content.split(/\n\s*\n/);
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        if (paragraph.trim().length === 0) continue;
        
        const paragraphLower = paragraph.toLowerCase();
        let matchScore = 0;
        let hasMatch = false;
        
        // Check if any query words appear in this paragraph
        for (const word of queryWords) {
          if (paragraphLower.includes(word)) {
            matchScore += 0.2;
            hasMatch = true;
          }
        }
        
        // If we found any matches in this paragraph
        if (hasMatch) {
          // Trim paragraph if it's too long
          let snippet = paragraph;
          if (snippet.length > contextSize * 3) {
            // Find the position of the first matching word
            let firstMatchPos = Infinity;
            for (const word of queryWords) {
              const pos = paragraphLower.indexOf(word);
              if (pos !== -1 && pos < firstMatchPos) {
                firstMatchPos = pos;
              }
            }
            
            // Extract snippet around the first match
            const snippetStart = Math.max(0, firstMatchPos - contextSize);
            const snippetEnd = Math.min(paragraph.length, firstMatchPos + contextSize * 2);
            snippet = paragraph.substring(snippetStart, snippetEnd);
            if (snippetStart > 0) snippet = '...' + snippet;
            if (snippetEnd < paragraph.length) snippet = snippet + '...';
          }
          
          // Add position score based on paragraph position in document
          const positionScore = 1 - (i / paragraphs.length) * 0.3;
          
          matches.push({
            text: snippet,
            score: matchScore + positionScore,
            position: i * 1000 // Use paragraph index as position
          });
        }
      }
    }

    // If still no matches, extract some representative content from the document
    if (matches.length === 0) {
      console.log(`No matches found, extracting representative content for "${normalizedQuery}"`);
      
      // Extract a few sections from the beginning of the document
      const sections = content.split(/\n\s*\n/).filter(s => s.trim().length > 0);
      const representativeSections = sections.slice(0, Math.min(3, sections.length));
      
      representativeSections.forEach((section, idx) => {
        // Trim section if it's too long
        let snippet = section;
        if (snippet.length > contextSize * 2) {
          snippet = snippet.substring(0, contextSize * 2) + '...';
        }
        
        matches.push({
          text: snippet,
          score: 0.3 - (idx * 0.1), // Decreasing score for each section
          position: idx * 1000
        });
      });
    }

    // Remove duplicates (snippets with significant overlap)
    const uniqueMatches: SnippetMatch[] = [];
    for (const match of matches) {
      const isDuplicate = uniqueMatches.some(existing => 
        existing.text === match.text || 
        (Math.abs(existing.position - match.position) < contextSize / 2 && 
         existing.text.length > 0 && match.text.length > 0 &&
         (existing.text.includes(match.text) || match.text.includes(existing.text)))
      );
      
      if (!isDuplicate) {
        uniqueMatches.push(match);
      }
    }

    // Sort by score and take top N
    return uniqueMatches
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSnippets);
  }

  private calculateScore(entry: BasicIndexEntry, query: string, options: { snippetContextSize?: number, maxSnippets?: number } = {}): SearchResult | null {
    const normalizedQuery = query.toLowerCase();
    const filename = entry.filename.toLowerCase();
    const filenameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
    const path = entry.path.toLowerCase();
    const content = entry.content?.toLowerCase() || '';

    // Exact filename match (highest priority)
    if (filenameWithoutExt === normalizedQuery) {
      return {
        ...entry,
        score: 1.0,
        matchType: 'exact'
      };
    }

    // Fuzzy filename match
    const fuseResults = this.filenameIndex.search(normalizedQuery);
    const filenameMatch = fuseResults.find(result => result.item === entry.filename);
    if (filenameMatch) {
      const fuseScore = 1 - (filenameMatch.score || 0);
      const score = 0.6 + (fuseScore * 0.3);
      return {
        ...entry,
        score,
        matchType: 'fuzzy'
      };
    }

    // Path contains query
    const pathWithoutFilename = path.substring(0, path.length - filename.length);
    if (pathWithoutFilename.includes(normalizedQuery)) {
      return {
        ...entry,
        score: 0.5,
        matchType: 'path'
      };
    }

    // Content contains query or parts of the query
    if (content) {
      // Always extract snippets, even if we don't find exact matches
      const snippets = this.extractSnippets(
        entry.content!, 
        query, 
        options.maxSnippets || 3,
        options.snippetContextSize || 60
      );
      
      // Check for exact content match
      if (content.includes(normalizedQuery)) {
        const occurrences = (content.match(new RegExp(normalizedQuery, 'g')) || []).length;
        const score = Math.min(0.3 + (occurrences * 0.1), 0.4);
        
        return {
          ...entry,
          score,
          matchType: 'content',
          snippets: snippets.length > 0 ? snippets : undefined
        };
      }
      
      // Check for partial matches (individual words)
      const queryWords = normalizedQuery.split(/\s+/).filter(word => word.length > 2);
      if (queryWords.length > 0) {
        const matchingWords = queryWords.filter(word => content.includes(word));
        if (matchingWords.length > 0) {
          // Calculate score based on how many words match
          const matchRatio = matchingWords.length / queryWords.length;
          const score = Math.min(0.2 + (matchRatio * 0.2), 0.35);
          
          console.log(`Partial match for "${query}" in ${entry.filename}: ${matchingWords.length}/${queryWords.length} words match`);
          
          return {
            ...entry,
            score,
            matchType: 'content',
            snippets: snippets.length > 0 ? snippets : undefined
          };
        }
      }
      
      // If we have any snippets but no matches were found above, still return a result
      if (snippets.length > 0) {
        console.log(`No direct matches found for "${query}" in ${entry.filename}, but returning representative snippets`);
        return {
          ...entry,
          score: 0.15, // Low score but still a match
          matchType: 'content',
          snippets
        };
      }
    }

    return null;
  }

  public async buildIndex(): Promise<void> {
    if (this.isIndexing) {
      console.log('Index build already in progress, skipping...');
      return;
    }

    this.isIndexing = true;
    console.log('Starting index build...');
    this.emit('indexing:start');

    try {
      console.log('Listing files...');
      const files = await mcpService.listFiles();
      console.log(`Found ${files.length} files`);
      let indexed = 0;
      
      // Reset indices
      this.memoryIndex.clear();
      const filenames: string[] = [];
      
      for (const filePath of files) {
        console.log(`Indexing file ${indexed + 1}/${files.length}: ${filePath}`);
        const fileInfo = await mcpService.readFile(filePath);
        const filename = path.basename(filePath);
        const entry: BasicIndexEntry = {
          path: filePath,
          filename,
          lastModified: fileInfo.lastModified,
          size: fileInfo.size
        };

        // Only store content if it's not empty
        if (fileInfo.content) {
          entry.content = fileInfo.content;
        }
        
        this.memoryIndex.set(filePath, entry);
        filenames.push(filename);
        indexed++;
        
        if (indexed % 100 === 0) {
          console.log(`Indexed ${indexed}/${files.length} files`);
          this.emit('indexing:progress', { total: files.length, current: indexed });
        }
      }

      // Build the Fuse index for filenames
      this.filenameIndex = new Fuse(filenames, this.fuseOptions);

      console.log(`Index build complete. Total files indexed: ${this.memoryIndex.size}`);
      this.emit('indexing:complete', { totalFiles: this.memoryIndex.size });
    } catch (error) {
      console.error('Error building index:', error);
      this.emit('indexing:error', error);
      throw error;
    } finally {
      this.isIndexing = false;
    }
  }

  public search(query: string, options: SearchOptions = {}): Omit<SearchResult, 'content'>[] {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery || normalizedQuery.length < 2) {
      return [];
    }

    console.log(`Searching for: "${normalizedQuery}" with options:`, options);
    console.log(`Current index size: ${this.memoryIndex.size} files`);

    const results: SearchResult[] = [];
    for (const entry of this.memoryIndex.values()) {
      // Apply file type filter if specified
      if (options.fileTypes && options.fileTypes.length > 0) {
        const fileExt = path.extname(entry.filename).toLowerCase().slice(1);
        if (!options.fileTypes.includes(fileExt)) {
          continue;
        }
      }

      const result = this.calculateScore(entry, normalizedQuery, {
        snippetContextSize: options.snippetContextSize || 60,
        maxSnippets: options.maxSnippets || 3
      });
      
      if (result) {
        results.push(result);
      }
    }

    // Sort by score (highest first) and then by date
    const sortedResults = results
      .sort((a, b) => {
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        return b.lastModified - a.lastModified;
      })
      .slice(0, 10); // Limit to top 10 results

    console.log(`Found ${results.length} matches, showing top ${sortedResults.length}`);
    if (options.fileTypes) {
      console.log(`Filtered by file types: ${options.fileTypes.join(', ')}`);
    }

    // Remove content from results before sending
    return sortedResults.map(({ content, ...rest }) => rest);
  }

  public getStats(): { totalFiles: number; isIndexing: boolean } {
    return {
      totalFiles: this.memoryIndex.size,
      isIndexing: this.isIndexing
    };
  }
}

export const searchIndex = new SearchIndex(); 