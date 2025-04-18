import { findChineseWordBoundary } from '../ChineseUtils';

export class TranscriptProcessor {
  private maxCharsPerLine: number;
  private maxLines: number;
  private lines: string[];
  private partialText: string;
  private lastUserTranscript: string;
  private finalTranscriptHistory: string[]; // Array to store history of final transcripts
  private finalWrappedLines: string[][] = []; // Store wrapped lines for each final transcript
  private maxFinalTranscripts: number; // Max number of final transcripts to keep
  private isChinese: boolean;

  constructor(maxCharsPerLine: number, maxLines: number, maxFinalTranscripts: number = 3, isChinese: boolean = false) {
    this.maxCharsPerLine = maxCharsPerLine;
    this.maxLines = maxLines;
    this.lastUserTranscript = "";
    this.lines = [];
    this.partialText = "";
    this.finalTranscriptHistory = []; // Initialize empty history
    this.finalWrappedLines = []; // Initialize empty wrapped lines array
    this.maxFinalTranscripts = maxFinalTranscripts; // Default to 3 if not specified
    this.isChinese = isChinese;
  }

  public processString(newText: string | null, isFinal: boolean): string {
    newText = (newText === null ? "" : newText.trim());

    if (!isFinal) {
      // Store this as the current partial text (overwriting old partial)
      this.partialText = newText;
      this.lastUserTranscript = newText;
      return this.buildPreview(this.partialText);
    } else {
      // Process final transcript
      if (newText.trim() !== "") {
        // Store the wrapped version of this final transcript
        const wrappedText = this.wrapText(newText, this.maxCharsPerLine);
        this.finalWrappedLines.push(wrappedText);
        
        // Add to transcript history
        this.addToTranscriptHistory(newText);

        // Ensure we don't exceed max final transcripts
        while (this.finalWrappedLines.length > this.maxFinalTranscripts) {
          this.finalWrappedLines.shift();
        }
      }

      // Clear out the partial text to avoid duplication
      this.partialText = "";

      // Return a formatted version of the full transcript history
      return this.getFormattedTranscriptHistory();
    }
  }

  // Format the final transcript history with consistent line breaks
  public getFormattedTranscriptHistory(): string {
    if (this.finalWrappedLines.length === 0) {
      // Return empty lines matching maxLines
      return Array(this.maxLines).fill("").join("\n");
    }

    // Flatten all wrapped transcripts into a single array of lines
    const allLines: string[] = [];
    for (const wrappedTranscript of this.finalWrappedLines) {
      allLines.push(...wrappedTranscript);
    }
    
    // Take only the last maxLines lines if there are more
    const displayLines = allLines.length > this.maxLines 
      ? allLines.slice(allLines.length - this.maxLines) 
      : allLines;
    
    // Add padding to ensure exactly maxLines are displayed
    const linesToPad = this.maxLines - displayLines.length;
    for (let i = 0; i < linesToPad; i++) {
      displayLines.push(""); // Add empty lines at the end
    }
    
    return displayLines.join("\n");
  }

  // Method to format partial transcript with history
  public getFormattedPartialTranscript(text: string): string {
    // Get all the already wrapped lines from finalized transcripts
    const allLines: string[] = [];
    for (const wrappedTranscript of this.finalWrappedLines) {
      allLines.push(...wrappedTranscript);
    }
    
    // Wrap the current partial text
    const wrappedPartial = this.wrapText(text, this.maxCharsPerLine);
    
    // Combine all lines
    const combinedLines = [...allLines, ...wrappedPartial];
    
    // Take only the last maxLines lines if there are more
    const displayLines = combinedLines.length > this.maxLines 
      ? combinedLines.slice(combinedLines.length - this.maxLines) 
      : combinedLines;
    
    // Add padding to ensure exactly maxLines are displayed
    const linesToPad = this.maxLines - displayLines.length;
    for (let i = 0; i < linesToPad; i++) {
      displayLines.push(""); // Add empty lines at the end
    }
    
    return displayLines.join("\n");
  }

  // Add to transcript history
  private addToTranscriptHistory(transcript: string): void {
    if (transcript.trim() === "") return; // Don't add empty transcripts
    
    this.finalTranscriptHistory.push(transcript);
    
    // Ensure we don't exceed maxFinalTranscripts
    while (this.finalTranscriptHistory.length > this.maxFinalTranscripts) {
      this.finalTranscriptHistory.shift(); // Remove oldest transcript
    }
  }

  // Get the transcript history
  public getFinalTranscriptHistory(): string[] {
    return [...this.finalTranscriptHistory]; // Return a copy to prevent external modification
  }

  // Get combined transcript history as a single string
  public getCombinedTranscriptHistory(): string {
    return this.finalTranscriptHistory.join(" ");
  }

  // Method to set max final transcripts
  public setMaxFinalTranscripts(maxFinalTranscripts: number): void {
    this.maxFinalTranscripts = maxFinalTranscripts;
    // Trim history if needed after changing the limit
    while (this.finalTranscriptHistory.length > this.maxFinalTranscripts) {
      this.finalTranscriptHistory.shift();
      this.finalWrappedLines.shift();
    }
  }

  // Get max final transcripts
  public getMaxFinalTranscripts(): number {
    return this.maxFinalTranscripts;
  }

  private buildPreview(partial: string): string {
    if (partial.trim() === "") {
      return this.getFormattedTranscriptHistory(); // Just show history if partial is empty
    }
    
    // Get all the already wrapped lines from finalized transcripts
    const allLines: string[] = [];
    for (const wrappedTranscript of this.finalWrappedLines) {
      allLines.push(...wrappedTranscript);
    }
    
    // Wrap the current partial text
    const wrappedPartial = this.wrapText(partial, this.maxCharsPerLine);
    
    // Combine all lines
    const combinedLines = [...allLines, ...wrappedPartial];
    
    // Take only the last maxLines lines if there are more
    const displayLines = combinedLines.length > this.maxLines 
      ? combinedLines.slice(combinedLines.length - this.maxLines) 
      : combinedLines;
    
    // Add padding to ensure exactly maxLines are displayed
    const linesToPad = this.maxLines - displayLines.length;
    for (let i = 0; i < linesToPad; i++) {
      displayLines.push(""); // Add empty lines at the end
    }
    
    return displayLines.join("\n");
  }

  private appendToLines(chunk: string): void {
    if (this.lines.length === 0) {
      this.lines.push(chunk);
    } else {
      const lastLine = this.lines.pop() as string;
      const candidate = lastLine === "" ? chunk : lastLine + " " + chunk;

      if (candidate.length <= this.maxCharsPerLine) {
        this.lines.push(candidate);
      } else {
        // Put back the last line if it doesn't fit
        this.lines.push(lastLine);
        this.lines.push(chunk);
      }
    }

    // Ensure we don't exceed maxLines
    while (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
  }

  private wrapText(text: string, maxLineLength: number): string[] {
    const result: string[] = [];
    while (text !== "") {
      if (text.length <= maxLineLength) {
        result.push(text);
        break;
      } else {
        let splitIndex = maxLineLength;
        
        if (this.isChinese) {
          // For Chinese text, find the last valid word boundary
          splitIndex = findChineseWordBoundary(text, maxLineLength);
        } else {
          // For non-Chinese text, find the last space before maxLineLength
          while (splitIndex > 0 && text.charAt(splitIndex) !== " ") {
            splitIndex--;
          }
          // If we didn't find a space, force split
          if (splitIndex === 0) {
            splitIndex = maxLineLength;
          }
        }

        const chunk = text.substring(0, splitIndex).trim();
        result.push(chunk);
        text = text.substring(splitIndex).trim();
      }
    }
    return result;
  }

  public getTranscript(): string {
    // Create a copy of the lines for manipulation
    const allLines = [...this.lines];

    // Add padding to ensure exactly maxLines are displayed
    const linesToPad = this.maxLines - allLines.length;
    for (let i = 0; i < linesToPad; i++) {
      allLines.push(""); // Add empty lines at the end
    }

    const finalString = allLines.join("\n");

    // Clear the lines
    this.lines = [];
    return finalString;
  }

  public getLastUserTranscript(): string {
    return this.lastUserTranscript;
  }

  public clear(): void {
    this.lines = [];
    this.partialText = "";
    this.finalTranscriptHistory = [];
    this.finalWrappedLines = [];
  }

  public getMaxCharsPerLine(): number {
    return this.maxCharsPerLine;
  }

  public getMaxLines(): number {
    return this.maxLines;
  }
}
