import { findChineseWordBoundary } from '../ChineseUtils';

export class TranscriptProcessor {
  private maxCharsPerLine: number;
  private maxLines: number;
  private lines: string[];
  private partialText: string;
  private lastUserTranscript: string;
  private finalTranscriptHistory: string[]; // Array to store history of final transcripts
  private finalWrappedLines: string[][]; // Store pre-wrapped lines for each final transcript
  private maxFinalTranscripts: number; // Max number of final transcripts to keep
  private isChinese: boolean;

  constructor(maxCharsPerLine: number, maxLines: number, maxFinalTranscripts: number = 3, isChinese: boolean = false) {
    this.maxCharsPerLine = maxCharsPerLine;
    this.maxLines = maxLines;
    this.lastUserTranscript = "";
    this.lines = [];
    this.partialText = "";
    this.finalTranscriptHistory = []; // Initialize empty history
    this.finalWrappedLines = []; // Initialize empty wrapped lines history
    this.maxFinalTranscripts = maxFinalTranscripts; // Default to 3 if not specified
    this.isChinese = isChinese;
  }

  public processString(newText: string | null, isFinal: boolean): string {
    newText = (newText === null ? "" : newText.trim());

    if (!isFinal) {
      // Store this as the current partial text (overwriting old partial)
      this.partialText = newText;
      this.lastUserTranscript = newText;
      
      // Just show partial text with finalized content
      return this.buildDisplayText();
    } else {
      // We have a final text
      if (newText.trim() !== "") {
        // Store the wrapped version of this final transcript
        const wrappedLines = this.wrapText(newText, this.maxCharsPerLine);
        this.finalWrappedLines.push(wrappedLines);
        
        // Add to transcript history
        this.addToTranscriptHistory(newText);
        
        // Ensure we don't exceed maxFinalTranscripts for wrapped lines too
        while (this.finalWrappedLines.length > this.maxFinalTranscripts) {
          this.finalWrappedLines.shift();
        }
      }
      
      // Clear partial text
      this.partialText = "";
      
      // Return the display with only final transcripts
      return this.buildDisplayText();
    }
  }

  // Build the display text from finalized and partial content
  private buildDisplayText(): string {
    // Collect all lines from finalized transcripts
    const allLines: string[] = [];
    this.finalWrappedLines.forEach(lines => {
      allLines.push(...lines);
    });
    
    // Add partial text if there is any
    if (this.partialText) {
      const partialLines = this.wrapText(this.partialText, this.maxCharsPerLine);
      allLines.push(...partialLines);
    }
    
    // Take only the last maxLines lines if there are more
    const displayLines = allLines.length > this.maxLines 
      ? allLines.slice(allLines.length - this.maxLines) 
      : allLines;
    
    // Add padding to ensure exactly maxLines are displayed
    const paddedLines = [...displayLines];
    const linesToPad = this.maxLines - displayLines.length;
    for (let i = 0; i < linesToPad; i++) {
      paddedLines.push(""); // Add empty lines at the end
    }
    
    return paddedLines.join("\n");
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
      if (this.finalWrappedLines.length > this.maxFinalTranscripts) {
        this.finalWrappedLines.shift();
      }
    }
  }

  // Get max final transcripts
  public getMaxFinalTranscripts(): number {
    return this.maxFinalTranscripts;
  }

  // For backward compatibility
  private buildPreview(partial: string): string {
    return this.buildDisplayText();
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
    // Build display text from final transcripts and partial
    return this.buildDisplayText();
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
