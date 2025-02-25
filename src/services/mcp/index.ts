import path from 'path';
import { promisify } from 'util';
import { readFile as fsReadFile, stat as fsStat } from 'fs/promises';
import os from 'os';
import { exec } from 'child_process';
import mammoth from 'mammoth';
import textract from 'textract';
import AdmZip from 'adm-zip';
import fs from 'fs';

const execAsync = promisify(exec);
const extractTextFromFile = promisify(textract.fromFileWithPath) as (filePath: string) => Promise<string>;

// Add a declaration for AdmZip if needed
declare module 'adm-zip';

export interface MCPFileContent {
  content: string;
  encoding: string;
  size: number;
  lastModified: number;
}

// Custom PDF parser implementation that doesn't require test data
async function parsePDF(dataBuffer: Buffer): Promise<{ text: string }> {
  try {
    // Import PDF.js directly
    // @ts-ignore - PDF.js types are complex, ignoring for now
    const pdfjs = await import('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
    const doc = await pdfjs.getDocument({ data: dataBuffer }).promise;
    const pages = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => 
        doc.getPage(i + 1).then((page: any) => page.getTextContent())
      )
    );
    
    const text = pages
      .map((page: any) => page.items.map((item: any) => item.str).join(' '))
      .join('\n');
    
    return { text };
  } catch (error) {
    console.error('Error in PDF parsing:', error);
    return { text: '' };
  }
}

class MCPService {
  private static instance: MCPService;
  private downloadsPath: string;

  private constructor() {
    // Use system Downloads folder
    this.downloadsPath = path.join(os.homedir(), 'Downloads');
  }

  public static getInstance(): MCPService {
    if (!MCPService.instance) {
      MCPService.instance = new MCPService();
    }
    return MCPService.instance;
  }

  public getDownloadsPath(): string {
    return this.downloadsPath;
  }

  private async extractPDFText(filePath: string): Promise<string> {
    let dataBuffer: Buffer;
    try {
      dataBuffer = await fsReadFile(filePath);
      const result = await parsePDF(dataBuffer);
      return result.text;
    } catch (error) {
      console.error('Error reading PDF file:', error);
      // Try to read as plain text if PDF parsing fails
      try {
        return dataBuffer!.toString('utf-8');
      } catch (textError) {
        console.error('Error reading as text:', textError);
        return '';
      }
    }
  }

  private async extractDocxText(filePath: string): Promise<string> {
    try {
      console.log(`Extracting text from DOCX file: ${filePath}`);
      
      // First try with mammoth
      const result = await mammoth.extractRawText({ path: filePath });
      let content = result.value;
      
      // If mammoth returns empty content, try alternative methods
      if (!content || content.trim().length === 0) {
        console.log(`Mammoth returned empty content for ${filePath}, trying alternative methods`);
        content = await this.fallbackDocxExtraction(filePath);
      }
      
      // Clean up the content
      content = this.cleanupDocxContent(content);
      
      // Log a sample of the extracted content for debugging
      console.log(`Extracted ${content.length} characters from ${filePath}`);
      if (content.length > 0) {
        console.log(`Sample content: ${content.substring(0, 200)}...`);
      } else {
        console.warn(`Warning: No content extracted from ${filePath}`);
      }
      
      return content;
    } catch (error) {
      console.error(`Error extracting text from DOCX file ${filePath}:`, error);
      return '';
    }
  }
  
  private async fallbackDocxExtraction(filePath: string): Promise<string> {
    try {
      // Try with textract first
      return new Promise((resolve, reject) => {
        textract.fromFileWithPath(filePath, { preserveLineBreaks: true }, (error: Error | null, text: string) => {
          if (error) {
            console.log(`Textract failed for ${filePath}, trying XML parsing`);
            // If textract fails, try XML parsing
            this.extractDocxWithXml(filePath)
              .then(content => resolve(content))
              .catch(err => {
                console.error(`XML parsing failed for ${filePath}:`, err);
                // Last resort: try to read the file as binary and extract text
                this.extractTextFromBinary(filePath)
                  .then(content => resolve(content))
                  .catch(() => resolve(''));
              });
          } else {
            resolve(text);
          }
        });
      });
    } catch (error) {
      console.error(`All fallback extraction methods failed for ${filePath}:`, error);
      return '';
    }
  }
  
  private async extractDocxWithXml(filePath: string): Promise<string> {
    try {
      // Extract the DOCX file (it's a ZIP file) and read document.xml
      const zip = new AdmZip(filePath);
      const contentXml = zip.getEntry('word/document.xml');
      
      if (!contentXml) {
        throw new Error('document.xml not found in DOCX file');
      }
      
      const xmlContent = contentXml.getData().toString();
      
      // Use a simple regex to extract text from XML
      // This is not perfect but can work as a fallback
      const textMatches = xmlContent.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
      const extractedText = textMatches
        .map((match: string) => match.replace(/<w:t[^>]*>(.*?)<\/w:t>/g, '$1'))
        .join(' ');
      
      return extractedText;
    } catch (error) {
      console.error(`Error extracting DOCX with XML parsing:`, error);
      throw error;
    }
  }
  
  private async extractTextFromBinary(filePath: string): Promise<string> {
    try {
      // Read the file as binary and look for text patterns
      const buffer = fs.readFileSync(filePath);
      const content = buffer.toString('utf8', 0, buffer.length);
      
      // Extract anything that looks like text
      const textMatches = content.match(/[A-Za-z0-9\s.,;:'"()\-]{5,}/g) || [];
      return textMatches.join(' ');
    } catch (error) {
      console.error(`Error extracting text from binary:`, error);
      throw error;
    }
  }
  
  private cleanupDocxContent(content: string): string {
    // Remove excessive whitespace
    let cleaned = content.replace(/\s+/g, ' ');
    
    // Remove common DOCX artifacts
    cleaned = cleaned.replace(/HYPERLINK "[^"]*"/g, '');
    
    // Restore paragraph breaks
    cleaned = cleaned.replace(/\. /g, '.\n\n');
    
    // Look specifically for "pro rata" terms and ensure they're preserved
    // This helps with the specific case mentioned by the user
    if (cleaned.toLowerCase().includes('pro rata')) {
      console.log('Found "pro rata" in the document content');
    }
    
    return cleaned;
  }

  private isContentReadableFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const textExtensions = [
      '.txt', '.md', '.json', '.js', '.ts', '.pdf', '.doc', '.docx',
      '.rtf', '.csv', '.xml', '.html', '.htm', '.css', '.scss', '.less',
      '.yaml', '.yml', '.ini', '.conf', '.log', '.env'
    ];
    return textExtensions.includes(ext);
  }

  private isBinaryOrMediaFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const binaryExtensions = [
      '.dmg', '.exe', '.dll', '.so', '.dylib', '.zip', '.tar', '.gz', '.rar',
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg', '.webp',
      '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.wma',
      '.mp4', '.avi', '.mkv', '.mov', '.wmv',
      '.ttf', '.otf', '.woff', '.woff2',
      '.db', '.sqlite', '.mdb',
      '.iso', '.bin', '.dat'
    ];
    return binaryExtensions.includes(ext);
  }

  public async readFile(filePath: string): Promise<MCPFileContent> {
    try {
      console.log(`Reading file: ${filePath}`);
      const stats = await fsStat(filePath);
      let content = '';
      let encoding = 'utf-8';

      // Skip content extraction for binary/media files
      if (this.isBinaryOrMediaFile(filePath)) {
        console.log('Skipping content extraction for binary/media file');
        return {
          content: '',
          encoding,
          size: stats.size,
          lastModified: stats.mtime.getTime()
        };
      }

      // Only attempt content extraction for known text-based files
      if (this.isContentReadableFile(filePath)) {
        try {
          const ext = path.extname(filePath).toLowerCase();
          switch (ext) {
            case '.pdf':
              console.log('Processing PDF file...');
              content = await this.extractPDFText(filePath);
              break;
            case '.docx':
            case '.doc':
              console.log('Processing Word document...');
              content = await this.extractDocxText(filePath);
              // Verify content was extracted
              if (!content || content.trim().length === 0) {
                console.warn('Warning: Empty content extracted from Word document');
              } else {
                console.log(`Successfully extracted ${content.length} characters from Word document`);
              }
              break;
            case '.txt':
            case '.md':
            case '.json':
            case '.js':
            case '.ts':
              console.log('Processing text file...');
              content = (await fsReadFile(filePath, 'utf-8')).toString();
              break;
            default:
              console.log('Attempting to extract text from supported file type...');
              try {
                content = await extractTextFromFile(filePath);
              } catch (err) {
                console.log('Falling back to simple text reading...');
                content = (await fsReadFile(filePath, 'utf-8')).toString();
              }
          }
        } catch (error) {
          console.error(`Error reading file content: ${error}`);
          content = ''; // Set empty content but don't fail completely
        }
      } else {
        console.log('Skipping content extraction for unknown file type');
      }

      console.log(`Successfully read file: ${filePath} (${content.length} chars)`);
      return {
        content,
        encoding,
        size: stats.size,
        lastModified: stats.mtime.getTime()
      };
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  }

  public async listFiles(): Promise<string[]> {
    try {
      console.log(`Scanning files in ${this.downloadsPath}...`);
      const { stdout } = await execAsync(`find "${this.downloadsPath}" -type f`);
      const files = stdout.split('\n').filter(Boolean);
      console.log(`Found ${files.length} files`);
      return files;
    } catch (error) {
      console.error('Error listing files:', error);
      throw error;
    }
  }

  public async isTextFile(filePath: string): Promise<boolean> {
    return this.isContentReadableFile(filePath);
  }
}

export const mcpService = MCPService.getInstance(); 