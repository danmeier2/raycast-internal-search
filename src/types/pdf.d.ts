declare module 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js' {
  interface TextItem {
    str: string;
  }

  interface TextContent {
    items: TextItem[];
  }

  interface PDFPageProxy {
    getTextContent(): Promise<TextContent>;
  }

  interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNum: number): Promise<PDFPageProxy>;
  }

  interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
  }

  export function getDocument(data: { data: Buffer }): PDFDocumentLoadingTask;
} 