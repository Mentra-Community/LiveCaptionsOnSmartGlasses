import { findChineseWordBoundary } from '../ChineseUtils';

export class TranscriptProcessor {
  private maxCharsPerLine: number;
  private maxLines: number;
  private lines: string[];
  private partialText: string;
  private lastUserTranscript: string;
  private finalTranscriptHistory: string[]; // Array to store history of final transcripts
  private maxFinalTranscripts: number; // Max number of final transcripts to keep
  private isChinese: boolean;
  private currentDisplayLines: string[]; // Track current display lines to maintain consistency

  constructor(maxCharsPerLine: number, maxLines: number, maxFinalTranscripts: number = 3, isChinese: boolean = false) {
    this.maxCharsPerLine = maxCharsPerLine;
    this.maxLines = maxLines;
    this.lastUserTranscript = "";
    this.lines = [];
    this.partialText = "";
    this.finalTranscriptHistory = []; // Initialize empty history
    this.maxFinalTranscripts = maxFinalTranscripts; // Default to 3 if not specified
    this.isChinese = isChinese;
    this.currentDisplayLines = []; // Initialize display lines
  }

  public processString(newText: string | null, isFinal: boolean): string {
    newText = (newText === null ? "" : newText.trim());

    if (!isFinal) {
      // Store this as the current partial text (overwriting old partial)
      this.partialText = newText;
      this.lastUserTranscript = newText;
      
      // Combine final history with new partial text
      const combinedText = this.getCombinedTranscriptHistory() + " " + newText;
      this.currentDisplayLines = this.wrapText(combinedText, this.maxCharsPerLine);
      
      // Ensure we have exactly maxLines
      while (this.currentDisplayLines.length < this.maxLines) {
        this.currentDisplayLines.push("");
      }
      while (this.currentDisplayLines.length > this.maxLines) {
        this.currentDisplayLines.shift();
      }
      
      return this.currentDisplayLines.join("\n");
    } else {
      // We have a final text -> clear out the partial text to avoid duplication
      this.partialText = "";

      // Add to transcript history when it's a final transcript
      this.addToTranscriptHistory(newText);

      // Use the same wrapping logic as partial to maintain consistency
      const combinedText = this.getCombinedTranscriptHistory();
      this.currentDisplayLines = this.wrapText(combinedText, this.maxCharsPerLine);
      
      // Ensure we have exactly maxLines
      while (this.currentDisplayLines.length < this.maxLines) {
        this.currentDisplayLines.push("");
      }
      while (this.currentDisplayLines.length > this.maxLines) {
        this.currentDisplayLines.shift();
      }
      
      return this.currentDisplayLines.join("\n");
    }
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
    }
  }

  // Get max final transcripts
  public getMaxFinalTranscripts(): number {
    return this.maxFinalTranscripts;
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
  }

  public getMaxCharsPerLine(): number {
    return this.maxCharsPerLine;
  }

  public getMaxLines(): number {
    return this.maxLines;
  }
}
