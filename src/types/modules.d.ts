declare module 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js' {
  interface PDFPageProxy {
    getTextContent(): Promise<PDFPageContent>;
  }

  interface PDFPageContent {
    items: Array<{ str: string }>;
  }

  interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNum: number): Promise<PDFPageProxy>;
  }

  interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }

  function getDocument(data: { data: Buffer }): PDFDocumentLoadingTask;
  
  export { getDocument };
}

declare module 'pdf-parse' {
  interface PDFData {
    text: string;
    numpages: number;
    info: any;
    metadata: any;
    version: string;
  }

  interface PDFOptions {
    version?: string | boolean;
    max?: number;
  }

  function parse(dataBuffer: Buffer, options?: PDFOptions): Promise<PDFData>;
  
  export { parse };
  export default parse;
}

declare module 'mammoth' {
  interface ExtractResult {
    value: string;
    messages: any[];
  }

  interface Options {
    path?: string;
    buffer?: Buffer;
  }

  export function extractRawText(options: Options): Promise<ExtractResult>;
}

declare module 'textract' {
  interface TextractOptions {
    preserveLineBreaks?: boolean;
    preserveOnlyMultipleLineBreaks?: boolean;
    includeAltText?: boolean;
  }

  function fromFileWithPath(
    filePath: string,
    callback: (error: Error | null, text: string) => void
  ): void;

  function fromBufferWithMime(
    mimeType: string,
    buffer: Buffer,
    options: TextractOptions | undefined,
    callback: (error: Error | null, text: string) => void
  ): void;

  function fromBufferWithMime(
    mimeType: string,
    buffer: Buffer,
    callback: (error: Error | null, text: string) => void
  ): void;

  export { fromFileWithPath, fromBufferWithMime };
} 