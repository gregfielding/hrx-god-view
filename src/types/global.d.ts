declare module 'jspdf' {
  export class jsPDF {
    constructor(options?: any);
    setFontSize(size: number): void;
    setFont(fontName: string, fontStyle?: string): void;
    text(text: string, x: number, y: number): void;
    addPage(): void;
    internal: {
      pageSize: {
        width: number;
        height: number;
      };
    };
    autoTable: (options: any) => void;
    getNumberOfPages(): number;
    setPage(pageNumber: number): void;
    save(filename: string): void;
  }
}

declare module 'jspdf-autotable' {
  // This module extends jsPDF with autoTable functionality
}

declare module 'xlsx' {
  export const utils: {
    book_new(): any;
    aoa_to_sheet(data: any[][]): any;
    json_to_sheet(data: any[]): any;
    table_to_sheet(table: HTMLElement): any;
    sheet_to_json(sheet: any, options?: any): any[];
    sheet_to_csv(sheet: any, options?: any): string;
    sheet_to_txt(sheet: any, options?: any): string;
    sheet_to_html(sheet: any, options?: any): string;
    writeFile(workbook: any, filename: string, options?: any): void;
    write(workbook: any, options?: any): any;
  };
  
  export const read: (data: any, options?: any) => any;
  export const readFile: (filename: string, options?: any) => any;
  export const writeFile: (workbook: any, filename: string, options?: any) => void;
  export const write: (workbook: any, options?: any) => any;
} 