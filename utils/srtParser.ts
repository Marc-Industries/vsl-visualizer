import { SrtEntry } from '../types';

const timeToSeconds = (timeString: string): number => {
  const [time, ms] = timeString.split(',');
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds + parseInt(ms, 10) / 1000;
};

export const parseSRT = (srtContent: string): SrtEntry[] => {
  const entries: SrtEntry[] = [];
  const blocks = srtContent.trim().split(/\n\s*\n/);

  blocks.forEach(block => {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      // Line 1 is ID (skip or store if needed)
      // Line 2 is Time: 00:00:01,000 --> 00:00:04,000
      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      
      if (timeMatch) {
        const text = lines.slice(2).join(' ').replace(/<[^>]*>/g, ''); // Remove HTML tags if any
        entries.push({
          id: lines[0].trim(),
          startTime: timeToSeconds(timeMatch[1]),
          endTime: timeToSeconds(timeMatch[2]),
          text: text.trim()
        });
      }
    }
  });

  return entries;
};

export const chunkSrtEntries = (entries: SrtEntry[], intervalSeconds: number) => {
  const chunks: { startTime: number; endTime: number; text: string }[] = [];
  
  if (entries.length === 0) return chunks;

  let currentChunk: SrtEntry[] = [];
  let chunkStartTime = entries[0].startTime;

  entries.forEach((entry, index) => {
    currentChunk.push(entry);
    
    // Check if adding this entry exceeds the interval relative to chunk start
    // OR if it's the last entry
    const duration = entry.endTime - chunkStartTime;
    
    if (duration >= intervalSeconds || index === entries.length - 1) {
      chunks.push({
        startTime: chunkStartTime,
        endTime: entry.endTime,
        text: currentChunk.map(e => e.text).join(' ')
      });
      
      // Reset for next chunk
      currentChunk = [];
      if (index < entries.length - 1) {
        chunkStartTime = entries[index + 1].startTime;
      }
    }
  });

  return chunks;
};
