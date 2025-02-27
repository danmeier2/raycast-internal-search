# Raycast Local File Search with LLM Integration

This Raycast extension provides powerful local file search capabilities with content indexing and LLM-powered analysis features.

## Features

### Search Capabilities
- Fast local file search with content indexing
- Fuzzy matching for filenames and content
- Snippet preview with highlighted search terms
- File type filtering
- Detailed metadata display

### LLM Integration
- File summarization using Anthropic's Claude AI
- Ask questions about file content
- Get AI-powered insights about your files

## Setup

### Important First Steps
1. Clone or fork the repository
2. Install dependencies: `npm install`
3. **Configure the folder to be indexed**:
   - Open `src/services/mcp/index.ts`
   - Locate the constructor method (around line 52)
   - Change the default path from `Downloads` to your preferred directory:
   ```typescript
   // Change this line
   this.downloadsPath = path.join(os.homedir(), 'Downloads');
   
   // To something like this for your Documents folder
   this.downloadsPath = path.join(os.homedir(), 'Documents');
   
   // Or for multiple directories (advanced)
   // You'll need to modify the listFiles method as well
   this.downloadsPath = path.join(os.homedir(), 'YourPreferredFolder');
   ```
4. Create a `.env` file in the root directory with your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   ```

### Starting the Application (Two-Step Process)
1. **First, start the server**:
   ```
   npm run dev:server
   ```
   This will start the backend server that handles file indexing and search.

2. **Then, in a separate terminal window, start Raycast**:
   ```
   npm run dev
   ```
   This will start the Raycast extension.

3. The extension should now be available in Raycast

## Usage

### Basic Search
1. Open Raycast and select "Search local files"
2. Type your search query
3. Browse through the results
4. Use the file type filter to narrow down results

### LLM Features
- Select a file from the search results to see AI-generated context about the file
- Ask natural language questions about your files
- Get AI-powered insights based on file content

### Advanced Usage
- For more precise searches, use specific keywords
- For natural language queries, phrase your question clearly
- The LLM will analyze the most relevant sections of your files based on your query

## Troubleshooting

- If search results aren't appearing, make sure the server is running (`npm run dev:server`)
- If the LLM features aren't working, check that your API key is correctly set in the `.env` file
- If you change the indexed directories, restart the server for changes to take effect
- If you're getting errors about file permissions, make sure the directories you're trying to index are accessible

## Development

### Prerequisites
- Node.js
- Raycast
- Anthropic API key

### Project Structure
- `src/search-local-files.tsx`: Main UI component
- `src/llm-utils.ts`: Utilities for LLM integration
- `src/extension.ts`: Extension lifecycle management
- `src/server/index.ts`: Backend server for file indexing and search
- `src/services/mcp/index.ts`: File system operations and content extraction
- `src/services/search/index.ts`: Search indexing and query processing

## License
MIT