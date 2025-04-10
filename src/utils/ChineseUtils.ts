import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';
import { pinyin } from 'pinyin-pro';

// Initialize jieba with the default dictionary
const jieba = Jieba.withDict(dict);

/**
 * Checks if text contains Chinese characters
 */
export function isChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text);
}

/**
 * Converts Chinese text to Pinyin format
 * Preserves word boundaries and keeps multi-character words together
 */
export function convertToPinyin(text: string): string {
  if (!isChinese(text)) return text;
  
  // Split text into Chinese and non-Chinese parts
  const parts = text.split(/([\u4e00-\u9fa5]+)/g);
  
  // Process each part
  const processedParts = parts.map(part => {
    if (!isChinese(part)) return part;
    
    // Use jieba instance to segment Chinese parts into words
    const words = jieba.cut(part);
    
    // Convert each word to Pinyin, keeping multi-character words together
    const pinyinWords = words.map(word => {
      if (!isChinese(word)) return word;
      // Convert the entire word to Pinyin without internal spaces
      return pinyin(word, {
        toneType: 'symbol',
        type: 'array',
        nonZh: 'removed',
        mode: 'normal'  // Use normal mode to get word-level Pinyin
      }).join('');
    });
    
    // Join words with spaces
    return pinyinWords.join(' ');
  });
  
  return processedParts.join('');
} 