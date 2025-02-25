import { ActionPanel, List, Action, showToast, Toast, Icon, Color, Detail } from "@raycast/api";
import { useState, useEffect } from "react";
import fetch from "node-fetch";
import { generateEnhancedContext, extractKeywordsFromQuery, generateAnswerFromDocument } from "./llm-utils";
import fs from "fs";
import path from "path";

interface SearchResult {
  path: string;
  filename: string;
  lastModified: number;
  size: number;
  score: number;
  matchType: 'exact' | 'fuzzy' | 'path' | 'content';
  snippets?: { text: string; score: number; position: number; }[];
  boosted?: boolean;
  originalScore?: number;
  boostAmount?: number;
}

interface SearchResponse {
  results: SearchResult[];
  stats: {
    totalResults: number;
    searchTime: number;
    filters?: {
      fileTypes?: string[];
    };
  };
}

const SERVER_PORT = 49152;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function getMatchTypeIcon(matchType: SearchResult['matchType']): Icon {
  switch (matchType) {
    case 'exact':
      return Icon.Star;
    case 'fuzzy':
      return Icon.MagnifyingGlass;
    case 'path':
      return Icon.Folder;
    case 'content':
      return Icon.Document;
  }
}

function getMatchTypeLabel(matchType: SearchResult['matchType']): string {
  switch (matchType) {
    case 'exact':
      return 'Exact Match';
    case 'fuzzy':
      return 'Similar Match';
    case 'path':
      return 'Path Match';
    case 'content':
      return 'Content Match';
  }
}

function getFileIcon(filename: string): Icon {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf':
      return Icon.Document;
    case 'doc':
    case 'docx':
      return Icon.TextDocument;
    case 'txt':
    case 'md':
      return Icon.Text;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
      return Icon.Image;
    default:
      return Icon.Document;
  }
}

// Helper function to highlight matching terms in the text
function highlightMatchingTerms(text: string, query?: string): string {
  if (!query) return text;
  
  // Split the query into terms
  const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
  
  let highlightedText = text;
  
  // Replace each search term with a bold version
  searchTerms.forEach(term => {
    // Case-insensitive replacement
    const regex = new RegExp(`(${term})`, 'gi');
    highlightedText = highlightedText.replace(regex, '**$1**');
  });
  
  return highlightedText;
}

function formatContentPreview(result: SearchResult | null, query?: string, llmContext?: string): string {
  if (!result) {
    if (!query || query.trim().length < 2) {
      return '# Start typing to search\n\nEnter at least 2 characters to search or ask a question about your files.';
    } else {
      return '# Searching...\n\nPlease wait while we search for results matching your query.';
    }
  }

  // For image files, return a properly formatted markdown image
  const ext = result.filename.split('.').pop()?.toLowerCase() || '';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'avif'].includes(ext);
  
  if (isImage) {
    // Use the file:// protocol with proper URI encoding for local files
    // Make sure to use absolute paths with triple slashes for file:///
    const absolutePath = result.path.startsWith('/') ? result.path : `/${result.path}`;
    return `![${result.filename}](file:///${encodeURIComponent(absolutePath)})`;
  }

  const sections = [];

  if (result.snippets && result.snippets.length > 0) {
    // Extract search terms for highlighting
    const searchTerms = query?.toLowerCase().split(/\s+/).filter(term => term.length > 2) || [];
    
    result.snippets.forEach((snippet, index) => {
      // Add spacing between snippets
      if (index > 0) {
        sections.push('\n\n');
      }
      
      // Show the search query in a monospace code block at the top
      const displayQuery = query?.trim() || 'search match';
      sections.push(`\`${displayQuery}\``);
      
      // Then show the entire snippet with highlighted terms
      let highlightedText = snippet.text.trim();
      
      // Highlight each search term with bold formatting
      if (searchTerms.length > 0) {
        searchTerms.forEach(term => {
          if (term.length > 2) {
            const pattern = new RegExp(`(${term})`, 'gi');
            highlightedText = highlightedText.replace(pattern, '**$1**');
          }
        });
      }
      
      // Add the snippet text in a blockquote for a grey background effect
      // Use a single blockquote for the entire snippet
      sections.push(`> ${highlightedText.replace(/\n/g, '\n> ')}`);
    });
  } else {
    // For DOCX files that might have content but no snippets
    const isDocx = ext === 'docx' || ext === 'doc';
    
    if (isDocx && query) {
      // Instead of just showing a message, try to extract some content from the document
      sections.push('*Content found but specific matches may not be highlighted*');
      sections.push('\n\nHere are some sections from the document that might be relevant:');
      
      // Try to get some content from the document using the MCP service
      try {
        const fs = require('fs');
        const content = fs.readFileSync(result.path, 'utf8');
        if (content && content.length > 0) {
          // Extract a few paragraphs
          const paragraphs = content.split(/\n\s*\n/).filter((p: string) => p.trim().length > 0);
          const sampleParagraphs = paragraphs.slice(0, Math.min(3, paragraphs.length));
          
          sampleParagraphs.forEach((paragraph: string, idx: number) => {
            if (idx > 0) sections.push('\n\n');
            
            // Trim paragraph if it's too long
            let trimmedParagraph = paragraph;
            if (trimmedParagraph.length > 300) {
              trimmedParagraph = trimmedParagraph.substring(0, 300) + '...';
            }
            
            // Try to highlight any query terms that might be in the paragraph
            const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
            let highlightedText = trimmedParagraph;
            
            searchTerms.forEach(term => {
              if (term.length > 2) {
                const pattern = new RegExp(`(${term})`, 'gi');
                highlightedText = highlightedText.replace(pattern, '**$1**');
              }
            });
            
            sections.push(`> ${highlightedText.replace(/\n/g, '\n> ')}`);
          });
        } else {
          sections.push('\n\nTry opening the file to search for your terms.');
        }
      } catch (error) {
        console.error('Error reading document content:', error);
        sections.push('\n\nTry opening the file to search for your terms.');
      }
    } else {
      sections.push('*No content matches found*');
      sections.push('\n\nThe document was indexed but no specific matches were found for your search terms.');
      sections.push('\n\nTry opening the file to search for your terms or try different search keywords.');
    }
  }

  // Add LLM context if available
  if (llmContext && llmContext !== "Analyzing content...") {
    sections.push('\n\n### AI Context\n');
    sections.push(llmContext);
  }

  return sections.join('\n');
}

function getScoreColor(score: number): Color {
  if (score > 0.8) return Color.Green;
  if (score > 0.5) return Color.Orange;
  return Color.Red;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countCharacters(text: string): number {
  return text.length;
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [fileTypeFilter, setFileTypeFilter] = useState<string | null>(null);
  const [llmContext, setLlmContext] = useState<string | null>(null);
  const [isLoadingLlm, setIsLoadingLlm] = useState(false);
  const [originalQuery, setOriginalQuery] = useState<string>("");
  const [isProcessingNaturalLanguage, setIsProcessingNaturalLanguage] = useState(false);

  // Extract unique file types from results
  const fileTypes = Array.from(new Set(results.map(r => {
    const ext = r.filename.split('.').pop()?.toLowerCase() || '';
    return ext ? ext : 'unknown';
  })));

  const filteredResults = fileTypeFilter 
    ? results.filter(r => r.filename.toLowerCase().endsWith(`.${fileTypeFilter}`))
    : results;

  const performSearch = async (query: string, isNaturalLanguage: boolean = false) => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      setIsLoading(false);
      setLlmContext(null);
      setSelectedResult(null);
      return;
    }

    // Clear previous results and context
    setResults([]);
    setSelectedResult(null);
    setLlmContext(null);
    setIsLoading(true);
    setError(null);

    try {
      // If this is a natural language query, extract keywords first
      let searchQuery = query;
      if (isNaturalLanguage) {
        setIsProcessingNaturalLanguage(true);
        setOriginalQuery(query); // Store the original query for later use
        searchQuery = await extractKeywordsFromQuery(query);
        setIsProcessingNaturalLanguage(false);
      } else {
        // For regular searches, still store the original query
        setOriginalQuery(query);
      }

      const response = await fetch(`${SERVER_URL}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          query: searchQuery,
          options: {
            snippetContextSize: 500, // Increased context size for LLM
            maxSnippets: 3 // Limit to 3 snippets per result for cleaner display
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json() as SearchResponse;
      
      // Apply custom scoring to boost results with search terms in their filenames
      const enhancedResults = enhanceSearchResults(data.results, searchQuery, query);
      
      setResults(enhancedResults);
      setSelectedResult(enhancedResults.length > 0 ? enhancedResults[0] : null);
    } catch (error) {
      console.error('Search error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Search failed';
      setError(errorMessage);
      showToast({
        style: Toast.Style.Failure,
        title: "Search failed",
        message: errorMessage
      });
      setResults([]);
      setSelectedResult(null);
    } finally {
      setIsLoading(false);
    }
  };
  
  /**
   * Enhance search results by applying custom scoring
   * @param results The original search results
   * @param searchQuery The search query used (keywords)
   * @param originalQuery The original user query
   * @returns Enhanced and re-sorted search results
   */
  const enhanceSearchResults = (
    results: SearchResult[], 
    searchQuery: string,
    originalQuery: string
  ): SearchResult[] => {
    if (!results.length) return results;
    
    // Extract terms from both the search query and original query
    const searchTerms = searchQuery.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    const originalTerms = originalQuery.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    const allTerms = [...new Set([...searchTerms, ...originalTerms])];
    
    // Create a copy of results to modify
    const enhancedResults = [...results].map(result => {
      let scoreBoost = 0;
      const filename = result.filename.toLowerCase();
      const path = result.path.toLowerCase();
      
      // Boost score for each search term found in the filename
      allTerms.forEach(term => {
        // Higher boost for exact matches in filename
        if (filename.includes(term)) {
          scoreBoost += 0.3;
          
          // Extra boost for terms at the beginning of the filename
          if (filename.startsWith(term)) {
            scoreBoost += 0.2;
          }
        }
        
        // Smaller boost for matches in the path
        if (path.includes(term)) {
          scoreBoost += 0.1;
        }
      });
      
      // Boost for exact phrase matches in filename
      if (searchQuery.length > 5 && filename.includes(searchQuery.toLowerCase())) {
        scoreBoost += 0.5;
      }
      
      if (originalQuery.length > 5 && filename.includes(originalQuery.toLowerCase())) {
        scoreBoost += 0.5;
      }
      
      // Apply the boost (capped at 0.99 total score)
      const newScore = Math.min(0.99, result.score + scoreBoost);
      
      // Add a flag to indicate this result was boosted
      const wasBoosted = scoreBoost > 0;
      
      return {
        ...result,
        score: newScore,
        // Add custom properties to track boosting
        boosted: wasBoosted,
        originalScore: result.score,
        boostAmount: scoreBoost
      };
    });
    
    // Re-sort results by the enhanced score
    return enhancedResults.sort((a, b) => b.score - a.score);
  };

  // Handle search text changes
  useEffect(() => {
    // Clear previous results and context when search text changes
    setResults([]);
    setSelectedResult(null);
    setLlmContext(null);
    setOriginalQuery("");
    
    if (searchText.trim().length >= 2) {
      // Determine if this looks like a natural language query
      const isNaturalLanguage = 
        searchText.trim().length > 15 && // Longer than typical keyword search
        (searchText.includes(" ") && // Has spaces
        (searchText.includes("?") || // Has question mark
         /^(what|how|when|where|who|why|can|does|is|are|will|should)/i.test(searchText.trim()))); // Starts with question word
      
      performSearch(searchText, isNaturalLanguage);
    } else {
      setResults([]);
      setSelectedResult(null);
    }
  }, [searchText]);

  // Effect to trigger LLM context generation when a result is selected
  useEffect(() => {
    // Clear previous LLM context when selection changes
    setLlmContext(null);
    
    if (selectedResult && searchText.trim()) {
      setIsLoadingLlm(true);
      
      // If we have an original natural language query and this is the top result
      if (originalQuery && results.indexOf(selectedResult) === 0) {
        // Try to get the full document content for better context
        const filePath = selectedResult.path;
        
        // Check if file exists and is readable
        try {
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            // Get file extension
            const ext = path.extname(filePath).toLowerCase();
            
            // For text files, read directly
            const isTextFile = ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.csv'].includes(ext);
            const isPdfFile = ext === '.pdf';
            const isDocFile = ['.doc', '.docx'].includes(ext);
            
            if (isTextFile) {
              try {
                const content = fs.readFileSync(filePath, 'utf8');
                // Generate answer from document content
                generateAnswerFromDocument(
                  content,
                  originalQuery || searchText, // Use original query if available
                  (partialResponse) => {
                    setLlmContext(partialResponse);
                    setIsLoadingLlm(false);
                  }
                );
                return; // Skip the regular snippet-based context generation
              } catch (err) {
                console.error('Error reading file:', err);
                // Fall back to snippet-based approach
              }
            } else if (isPdfFile || isDocFile) {
              // For PDF and DOCX files, try to use the MCP service to extract content
              try {
                // Make a request to the server to get file content
                fetch(`${SERVER_URL}/file?path=${encodeURIComponent(filePath)}`, {
                  method: 'GET',
                  headers: {
                    'Content-Type': 'application/json',
                  }
                })
                .then(response => {
                  if (!response.ok) {
                    throw new Error(`Failed to get file content: ${response.statusText}`);
                  }
                  return response.json();
                })
                .then(data => {
                  if (data && typeof data === 'object' && 'content' in data) {
                    // Generate answer from document content
                    generateAnswerFromDocument(
                      data.content as string,
                      originalQuery,
                      (partialResponse) => {
                        setLlmContext(partialResponse);
                        setIsLoadingLlm(false);
                      }
                    );
                  } else {
                    // Fall back to snippet-based approach
                    fallbackToSnippets();
                  }
                })
                .catch(error => {
                  console.error('Error getting file content:', error);
                  // Fall back to snippet-based approach
                  fallbackToSnippets();
                });
                
                return; // Skip the regular snippet-based context generation while we wait for the response
              } catch (err) {
                console.error('Error using MCP service:', err);
                // Fall back to snippet-based approach
              }
            }
          }
        } catch (err) {
          console.error('Error accessing file:', err);
          // Fall back to snippet-based approach
        }
      }
      
      // Function to fall back to snippet-based approach
      const fallbackToSnippets = () => {
        if (selectedResult && selectedResult.snippets && selectedResult.snippets.length > 0) {
          // Combine all snippets for context
          const combinedSnippets = selectedResult.snippets.map(s => s.text).join("\n\n");
          
          // Generate enhanced context with LLM
          generateEnhancedContext(
            combinedSnippets,
            originalQuery || searchText, // Use original query if available
            (partialResponse) => {
              setLlmContext(partialResponse);
              setIsLoadingLlm(false);
            }
          );
        } else {
          setLlmContext("No content available to analyze for this file.");
          setIsLoadingLlm(false);
        }
      };
      
      // Fall back to the original snippet-based approach if we couldn't use the full document
      fallbackToSnippets();
    } else {
      setLlmContext(null);
    }
  }, [selectedResult]);

  // For image files, show special metadata
  const ext = selectedResult?.filename.split('.').pop()?.toLowerCase() || '';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'avif'].includes(ext);
  
  const contentStats = {
    characters: selectedResult?.snippets 
      ? selectedResult.snippets.reduce((sum, snippet) => sum + snippet.text.length, 0)
      : 0,
    words: selectedResult?.snippets
      ? selectedResult.snippets.reduce((sum, snippet) => sum + countWords(snippet.text), 0)
      : 0
  };

  return (
    <List
      isLoading={isLoading || isProcessingNaturalLanguage}
      navigationTitle="Search Local Files"
      searchBarPlaceholder="Search or ask questions about your files..."
      throttle={true}
      onSearchTextChange={setSearchText}
      onSelectionChange={(id) => {
        const result = results.find((item, index) => `${item.path}-${index}` === id);
        if (result) {
          setSelectedResult(result);
        }
      }}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by file type"
          value={fileTypeFilter || "all"}
          onChange={(newValue) => setFileTypeFilter(newValue === "all" ? null : newValue)}
        >
          <List.Dropdown.Item title="All Types" value="all" />
          {fileTypes.map(type => (
            <List.Dropdown.Item key={type} title={type.toUpperCase()} value={type} />
          ))}
        </List.Dropdown>
      }
      selectedItemId={selectedResult ? `${selectedResult.path}-${results.indexOf(selectedResult)}` : undefined}
      isShowingDetail={true}
      enableFiltering={false}
    >
      {error ? (
        <List.EmptyView
          title="Error"
          description={error}
        />
      ) : searchText.trim().length < 2 ? (
        <List.EmptyView
          title="Start typing to search"
          description="Enter at least 2 characters to search or ask a question"
        />
      ) : isLoading || isProcessingNaturalLanguage ? (
        <List.EmptyView
          title={isProcessingNaturalLanguage ? "Processing your question..." : "Searching..."}
          description="Please wait while we process your query"
        />
      ) : filteredResults.length === 0 ? (
        <List.EmptyView
          title="No results found"
          description="Try a different search term or question"
        />
      ) : (
        <List.Section title={originalQuery ? `Results for: "${originalQuery}"` : `Results for: "${searchText}"`}>
          {filteredResults.map((item, index) => {
            // Determine if this is an image file
            const ext = item.filename.split('.').pop()?.toLowerCase() || '';
            const isImage = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'avif'].includes(ext);
            
            return (
              <List.Item
                key={`${item.path}-${index}`}
                id={`${item.path}-${index}`}
                title={item.filename}
                icon={isImage ? Icon.Image : getFileIcon(item.filename)}
                accessories={[
                  { 
                    tag: { 
                      value: `${Math.round(item.score * 100)}%`, 
                      color: getScoreColor(item.score) 
                    } 
                  },
                  // Add a star icon for boosted results
                  ...(item.boosted ? [{ icon: Icon.Star, tooltip: "Boosted result" }] : [])
                ]}
                detail={
                  <List.Item.Detail
                    markdown={formatContentPreview(
                      item, 
                      originalQuery || searchText,
                      selectedResult && selectedResult.path === item.path && llmContext ? llmContext : undefined
                    )}
                    isLoading={!!(selectedResult && selectedResult.path === item.path && isLoadingLlm)}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title="Information" />
                        <List.Item.Detail.Metadata.Separator />
                        
                        <List.Item.Detail.Metadata.Label title="Filename" text={item.filename} icon={getFileIcon(item.filename)} />
                        <List.Item.Detail.Metadata.Label title="Source" text="Local File" icon={Icon.Folder} />
                        <List.Item.Detail.Metadata.Label title="Content type" text={ext.toUpperCase() || 'Unknown'} />
                        
                        {isImage ? (
                          <>
                            <List.Item.Detail.Metadata.Label title="Dimensions" text="N/A" />
                            <List.Item.Detail.Metadata.Label title="Image size" text={formatFileSize(item.size)} />
                          </>
                        ) : (
                          <>
                            <List.Item.Detail.Metadata.Label 
                              title="Characters" 
                              text={item.snippets ? countCharacters(item.snippets.map(s => s.text).join('')).toString() : '0'} 
                            />
                            <List.Item.Detail.Metadata.Label 
                              title="Words" 
                              text={item.snippets ? countWords(item.snippets.map(s => s.text).join('')).toString() : '0'} 
                            />
                          </>
                        )}
                        <List.Item.Detail.Metadata.Label title="File size" text={formatFileSize(item.size)} />
                        <List.Item.Detail.Metadata.Label title="Last modified" text={formatDate(item.lastModified)} />
                        
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.TagList title="Relevance">
                          <List.Item.Detail.Metadata.TagList.Item
                            text={`${Math.round(item.score * 100)}%`}
                            color={getScoreColor(item.score)}
                          />
                          {item.boosted && (
                            <List.Item.Detail.Metadata.TagList.Item
                              text="Boosted"
                              color={Color.Yellow}
                            />
                          )}
                        </List.Item.Detail.Metadata.TagList>
                        <List.Item.Detail.Metadata.Label title="Match type" text={getMatchTypeLabel(item.matchType)} />
                        {item.boosted && item.originalScore !== undefined && (
                          <List.Item.Detail.Metadata.Label 
                            title="Original score" 
                            text={`${Math.round(item.originalScore * 100)}%`} 
                          />
                        )}
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.Link title="Path" target={item.path} text={item.path} />
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <ActionPanel>
                    <ActionPanel.Section>
                      <Action.Open
                        title="Open File"
                        target={item.path}
                        icon={Icon.Document}
                      />
                      <Action.ShowInFinder
                        path={item.path}
                        title="Show in Finder"
                        icon={Icon.Finder}
                      />
                      <Action.OpenWith
                        path={item.path}
                        title="Open With..."
                        icon={Icon.AppWindow}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section>
                      <Action.CopyToClipboard
                        content={item.path}
                        title="Copy Path"
                        icon={Icon.Clipboard}
                      />
                    </ActionPanel.Section>
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}
    </List>
  );
}