import { convertToCoreMessages } from 'ai';
import type { Message } from 'ai';
import { EXCLUDED_FILE_PATHS } from './constants.js';

export function cleanupAssistantMessages(messages: Message[]) {
  let processedMessages = messages.map((message) => {
    if (message.role === 'assistant') {
      let content = cleanMessage(message.content);
      const parts = message.parts?.map((part) => {
        if (part.type === 'text') {
          part.text = cleanMessage(part.text);
        }
        return part;
      });
      return { ...message, content, parts };
    }
    return message;
  });

  // Filter out empty messages
  processedMessages = processedMessages.filter(
    (message) =>
      message.content.trim() !== '' ||
      (message.parts && message.parts.filter((p) => p.type === 'text' || p.type === 'tool-invocation').length > 0),
  );

  return convertToCoreMessages(processedMessages).filter((m) => m.content.length > 0);
}

function cleanMessage(message: string) {
  message = message.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
  message = message.replace(/<think>.*?<\/think>/s, '');

  for (const excludedPath of EXCLUDED_FILE_PATHS) {
    const escapedPath = excludedPath.replace(/\//g, '\\/');
    message = message.replace(
      new RegExp(`<boltAction type="file" filePath="${escapedPath}"[^>]*>[\\s\\S]*?<\\/boltAction>`, 'g'),
      `You tried to modify \`${excludedPath}\` but this is not allowed. Modify a different file instead.`,
    );
  }

  return message;
}
