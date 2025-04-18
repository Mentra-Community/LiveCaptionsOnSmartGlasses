import { findChineseWordBoundary } from '../ChineseUtils';

export class TranscriptProcessor {
  private maxCharsPerLine: number;
  private maxLines: number;
  private partialText: string;
  private lastUserTranscript: string;
  private finalTranscriptHistory: string[]; // Array to store history of final transcripts
  private maxFinalTranscripts: number; // Max number of final transcripts to keep
  private isChinese: boolean;

  constructor(maxCharsPerLine: number, maxLines: number, maxFinalTranscripts: number = 3, isChinese: boolean = false) {
    this.maxCharsPerLine = maxCharsPerLine;
    this.maxLines = maxLines;
    this.lastUserTranscript = "";
    this.partialText = "";
    this.finalTranscriptHistory = []; // Initialize empty history
    this.maxFinalTranscripts = maxFinalTranscripts; // Default to 3 if not specified
    this.isChinese = isChinese;
  }

  public processString(newText: string | null, isFinal: boolean): string {
    newText = (newText === null ? "" : newText.trim());

    if (!isFinal) {
      // Store this as the current partial text (overwriting old partial)
      this.partialText = newText;
      this.lastUserTranscript = newText;
      
      // For display consistency, get the combined transcript history plus current partial
      const combinedText = this.getCombinedTranscriptHistory();
      const displayText = combinedText ? combinedText + " " + this.partialText : this.partialText;
      return this.getFormattedDisplay(displayText);
    } else {
      // Clear the partial text and add to transcript history
      this.partialText = "";
      this.addToTranscriptHistory(newText);

      // Return the formatted display with the same logic as partial
      return this.getFormattedDisplay(this.getCombinedTranscriptHistory());
    }
  }

  // Unified display formatting method to ensure consistency
  private getFormattedDisplay(text: string): string {
    if (!text) return this.getEmptyDisplay();
    
    // Wrap the text consistently
    const wrapped = this.wrapText(text, this.maxCharsPerLine);
    
    // Take only the last maxLines lines if there are more
    const displayLines = wrapped.length > this.maxLines 
      ? wrapped.slice(wrapped.length - this.maxLines) 
      : wrapped;
    
    // Add padding to ensure exactly maxLines are displayed
    const linesToPad = this.maxLines - displayLines.length;
    for (let i = 0; i < linesToPad; i++) {
      displayLines.push(""); // Add empty lines at the end
    }
    
    return displayLines.join("\n");
  }

  // Returns empty display with proper line count
  private getEmptyDisplay(): string {
    const emptyLines = Array(this.maxLines).fill("");
    return emptyLines.join("\n");
  }

  // New method to get formatted transcript history
  public getFormattedTranscriptHistory(): string {
    return this.getFormattedDisplay(this.getCombinedTranscriptHistory());
  }

  // Method to format partial transcript with history
  public getFormattedPartialTranscript(combinedText: string): string {
    // Use the unified formatting method
    return this.getFormattedDisplay(combinedText);
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
    return this.finalTranscriptHistory.length > 0 ? this.finalTranscriptHistory.join(" ") : "";
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
    return this.getFormattedDisplay(this.getCombinedTranscriptHistory());
  }

  public getLastUserTranscript(): string {
    return this.lastUserTranscript;
  }

  public clear(): void {
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
